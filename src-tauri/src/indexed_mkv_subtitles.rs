//! Sparse, indexed S_TEXT/UTF8 extraction from HTTP Matroska media.
//! A large debrid MKV may take minutes to scan with FFmpeg even though its
//! CueTrackPositions name exact subtitle blocks. Fetch only those blocks.
//! Unsupported/incomplete indexes return None: never save a truncated SRT.
//! URLs, response bodies and headers are never logged or persisted.
use std::collections::HashMap;
use std::time::Duration;

use futures_util::{stream, StreamExt, TryStreamExt};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, RANGE, USER_AGENT};
use reqwest::{Client, StatusCode};

const MAX_HEAD: usize = 2 * 1024 * 1024;
const MAX_CUES: usize = 2 * 1024 * 1024;
const MAX_BLOCK: usize = 32 * 1024;
const MAX_OUTPUT: usize = 4 * 1024 * 1024;
const CONCURRENT_READS: usize = 6;

#[derive(Clone, Copy, Debug)]
struct Element {
    id: u64,
    begin: usize,
    end: usize,
    size: usize,
}

#[derive(Clone, Copy, Debug)]
struct Cue {
    byte_pos: u64,
    start_ms: u64,
    duration_ms: u64,
}

#[derive(Clone, Debug)]
pub(crate) struct SubtitleCue {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

fn vint(b: &[u8], offset: usize, is_id: bool) -> Option<(u64, usize)> {
    let first = *b.get(offset)?;
    let width = (1..=8).find(|w| first & (0x80 >> (w - 1)) != 0)?;
    let mut value = if is_id {
        u64::from(first)
    } else {
        u64::from(first & ((1u16 << (8 - width)) - 1) as u8)
    };
    for index in 1..width {
        value = value
            .checked_mul(256)?
            .checked_add(u64::from(*b.get(offset.checked_add(index)?)?))?;
    }
    Some((value, width))
}

fn children(data: &[u8], from: usize, to: usize) -> Vec<Element> {
    let mut result = Vec::new();
    let mut offset = from;
    while offset < to && result.len() < 200_000 {
        let Some((id, id_width)) = vint(data, offset, true) else {
            break;
        };
        let Some((size, size_width)) = vint(data, offset + id_width, false) else {
            break;
        };
        let Some(begin) = offset.checked_add(id_width + size_width) else {
            break;
        };
        let Some(end) = usize::try_from(size)
            .ok()
            .and_then(|n| begin.checked_add(n))
        else {
            break;
        };
        if end > to || end > data.len() {
            break;
        }
        result.push(Element {
            id,
            begin,
            end,
            size: end - begin,
        });
        offset = end;
    }
    result
}

fn field<'a>(items: &'a [Element], id: u64) -> Option<&'a Element> {
    items.iter().find(|e| e.id == id)
}

fn number(data: &[u8], e: &Element) -> Option<u64> {
    if e.size > 8 {
        return None;
    }
    let mut value = 0u64;
    for &byte in data.get(e.begin..e.end)? {
        value = value.checked_mul(256)?.checked_add(u64::from(byte))?;
    }
    Some(value)
}

fn segment_data_offset(data: &[u8]) -> Option<usize> {
    let id = [0x18, 0x53, 0x80, 0x67];
    for offset in 0..data.len().min(4096).saturating_sub(4) {
        if data.get(offset..offset + 4) == Some(&id) {
            let (_, n) = vint(data, offset + 4, false)?;
            return offset.checked_add(4 + n);
        }
    }
    None
}

fn find_cues_offset(head: &[u8], seg: usize) -> Option<u64> {
    let top = children(head, seg, head.len());
    let seek_head = field(&top, 0x114d9b74)?;
    for item in children(head, seek_head.begin, seek_head.end) {
        if item.id != 0x4dbb {
            continue;
        }
        let parts = children(head, item.begin, item.end);
        let id = field(&parts, 0x53ab)?;
        let pos = field(&parts, 0x53ac)?;
        if number(head, id)? == 0x1c53bb6b {
            return u64::try_from(seg).ok()?.checked_add(number(head, pos)?);
        }
    }
    None
}

fn selected_utf8_track(head: &[u8], seg: usize, index: u32) -> Option<(u64, u64)> {
    let top = children(head, seg, head.len());
    let tracks = field(&top, 0x1654ae6b)?;
    let info = field(&top, 0x1549a966)?;
    let scale = {
        let fields = children(head, info.begin, info.end);
        field(&fields, 0x2ad7b1)
            .and_then(|e| number(head, e))
            .unwrap_or(1_000_000)
    };
    if scale == 0 || scale > 100_000_000 {
        return None;
    }
    let mut ordinal = 0u32;
    for entry in children(head, tracks.begin, tracks.end) {
        if entry.id != 0xae {
            continue;
        }
        let fields = children(head, entry.begin, entry.end);
        let kind = field(&fields, 0x83).and_then(|e| number(head, e));
        if kind != Some(17) {
            continue;
        }
        if ordinal == index {
            let track = number(head, field(&fields, 0xd7)?)?;
            let codec = field(&fields, 0x86)?;
            let value = std::str::from_utf8(head.get(codec.begin..codec.end)?).ok()?;
            return (value == "S_TEXT/UTF8" && (1..=127).contains(&track))
                .then_some((track, scale));
        }
        ordinal += 1;
    }
    None
}

fn cue_positions(blob: &[u8], seg: usize, track: u64, scale: u64) -> Option<Vec<Cue>> {
    let (id, id_width) = vint(blob, 0, true)?;
    if id != 0x1c53bb6b {
        return None;
    }
    let (len, len_width) = vint(blob, id_width, false)?;
    let start = id_width + len_width;
    let end = start.checked_add(usize::try_from(len).ok()?)?;
    if end != blob.len() {
        return None;
    }
    let mut found = Vec::new();
    for point in children(blob, start, end) {
        if point.id != 0xbb {
            continue;
        }
        let parts = children(blob, point.begin, point.end);
        let time = number(blob, field(&parts, 0xb3)?)?;
        for position in &parts {
            if position.id != 0xb7 {
                continue;
            }
            let fields = children(blob, position.begin, position.end);
            if number(blob, field(&fields, 0xf7)?)? != track {
                continue;
            }
            let cluster = number(blob, field(&fields, 0xf1)?)?;
            let relative = number(blob, field(&fields, 0xf0)?)?;
            let duration = number(blob, field(&fields, 0xb2)?)?;
            let begin = u64::try_from(seg)
                .ok()?
                .checked_add(cluster)?
                .checked_add(relative)?;
            let start_ms = time.checked_mul(scale)? / 1_000_000;
            let duration_ms = duration.checked_mul(scale)? / 1_000_000;
            if duration_ms == 0 || duration_ms > 120_000 {
                return None;
            }
            found.push(Cue {
                byte_pos: begin,
                start_ms,
                duration_ms,
            });
        }
        if found.len() > 10_000 {
            return None;
        }
    }
    if !(1..=10_000).contains(&found.len()) {
        return None;
    }
    Some(found)
}

fn read_block(bytes: &[u8], expected_track: u64) -> Option<String> {
    let mut group = None;
    for shift in 0..bytes.len().min(20) {
        let id = *bytes.get(shift)?;
        if id != 0xa0 && id != 0xa3 {
            continue;
        }
        let Some((size, width)) = vint(bytes, shift + 1, false) else {
            continue;
        };
        let begin = shift + 1 + width;
        let Some(end) = usize::try_from(size)
            .ok()
            .and_then(|s| begin.checked_add(s))
        else {
            continue;
        };
        if end > bytes.len() {
            continue;
        }
        let payload = if id == 0xa3 {
            bytes.get(begin..end)?
        } else {
            let nested = children(bytes, begin, end);
            let Some(block) = field(&nested, 0xa1) else {
                continue;
            };
            bytes.get(block.begin..block.end)?
        };
        let Some((track, twidth)) = vint(payload, 0, false) else {
            continue;
        };
        if track != expected_track || twidth + 3 >= payload.len() {
            continue;
        }
        // Text subtitle blocks are never laced. Reject any laced or
        // non-UTF8 block rather than silently skipping dialogue.
        if payload[twidth + 2] & 0x06 != 0 {
            continue;
        }
        let text = std::str::from_utf8(&payload[twidth + 3..])
            .ok()?
            .trim_matches('\0');
        if text.is_empty() {
            continue;
        }
        group = Some(text.to_string());
        break;
    }
    group
}

fn format_timestamp(ms: u64) -> String {
    let hours = ms / 3_600_000;
    let minutes = (ms / 60_000) % 60;
    let seconds = (ms / 1000) % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02},{:03}", ms % 1000)
}

pub(crate) fn to_srt(cues: &[SubtitleCue], subtract_ms: u64) -> String {
    let mut text = String::new();
    for (i, cue) in cues.iter().enumerate() {
        let from = cue.start_ms.saturating_sub(subtract_ms);
        let to = cue.end_ms.saturating_sub(subtract_ms);
        if from >= to {
            continue;
        }
        text.push_str(&format!(
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            format_timestamp(from),
            format_timestamp(to),
            cue.text
        ));
    }
    text
}

async fn range(client: &Client, url: &str, start: u64, len: usize) -> Option<Vec<u8>> {
    if len == 0 || len > MAX_HEAD {
        return None;
    }
    let end = start
        .checked_add(u64::try_from(len).ok()?)?
        .checked_sub(1)?;
    let response = client
        .get(url)
        .header(RANGE, format!("bytes={start}-{end}"))
        .send()
        .await
        .ok()?;
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return None;
    }
    let h = response.headers().get("content-range")?.to_str().ok()?;
    if !h.starts_with(&format!("bytes {start}-{end}/")) {
        return None;
    }
    if let Some(n) = response.content_length() {
        if n != u64::try_from(len).ok()? {
            return None;
        }
    }
    let mut response = response;
    let mut out = Vec::with_capacity(len);
    while let Some(chunk) = response.chunk().await.ok()? {
        if out.len().checked_add(chunk.len())? > len {
            return None;
        }
        out.extend_from_slice(&chunk);
    }
    (out.len() == len).then_some(out)
}

async fn block_at(client: &Client, url: &str, cue: Cue, track: u64) -> Option<SubtitleCue> {
    let data = range(client, url, cue.byte_pos, 2048).await?;
    let mut text = read_block(&data, track);
    // A few long captions, especially with formatting, exceed a single
    // small range. Retry boundedly; never fetch large video clusters.
    if text.is_none() {
        let larger = range(client, url, cue.byte_pos, MAX_BLOCK).await?;
        text = read_block(&larger, track);
    }
    let text = text?;
    let end_ms = cue.start_ms.checked_add(cue.duration_ms)?;
    Some(SubtitleCue {
        start_ms: cue.start_ms,
        end_ms,
        text,
    })
}

/// Returns Some only when EVERY indexed subtitle cue was recovered.
/// An optional window range can narrow reads to Auto sync's sampled scenes.
pub(crate) async fn extract(
    source: &str,
    selected_ordinal: u32,
    headers: Option<&HashMap<String, String>>,
    windows: Option<&[(f64, f64)]>,
) -> Option<Vec<SubtitleCue>> {
    if !source.starts_with("https://")
        || selected_ordinal > 31
        || crate::subsync::url_guard::validate_media_url(source, false).is_err()
    {
        return None;
    }
    let mut request_headers = HeaderMap::new();
    request_headers.insert(
        USER_AGENT,
        HeaderValue::from_static("VLC/3.0.20 LibVLC/3.0.20"),
    );
    if let Some(headers) = headers {
        for (key, value) in headers {
            if value.chars().any(char::is_control) {
                continue;
            }
            let k = key.to_ascii_lowercase();
            if !["user-agent", "referer", "authorization", "cookie", "origin"].contains(&k.as_str())
            {
                continue;
            }
            let (Ok(name), Ok(value)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(value),
            ) else {
                continue;
            };
            request_headers.insert(name, value);
        }
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .default_headers(request_headers)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5
                || crate::subsync::url_guard::validate_media_url(attempt.url().as_str(), false)
                    .is_err()
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .ok()?;
    let first = range(&client, source, 0, MAX_HEAD).await?;
    let seg = segment_data_offset(&first)?;
    let (track, scale) = selected_utf8_track(&first, seg, selected_ordinal)?;
    let cues_at = find_cues_offset(&first, seg)?;
    let preface = range(&client, source, cues_at, 24).await?;
    let (id, width) = vint(&preface, 0, true)?;
    if id != 0x1c53bb6b {
        return None;
    }
    let (size, size_width) = vint(&preface, width, false)?;
    let total = usize::try_from(size)
        .ok()?
        .checked_add(width + size_width)?;
    if total > MAX_CUES || total < 12 {
        return None;
    }
    let cues = range(&client, source, cues_at, total).await?;
    let all_positions = cue_positions(&cues, seg, track, scale)?;
    let selected: Vec<_> = all_positions
        .into_iter()
        .filter(|cue| {
            windows.is_none_or(|windows| {
                windows.iter().any(|&(start, length)| {
                    (cue.start_ms as f64) >= start * 1000.0
                        && (cue.start_ms as f64) < (start + length) * 1000.0
                })
            })
        })
        .collect();
    if selected.is_empty() {
        return None;
    }
    let mut result: Vec<SubtitleCue> = stream::iter(selected)
        .map(|cue| {
            let client = &client;
            async move { block_at(client, source, cue, track).await.ok_or(()) }
        })
        .buffer_unordered(CONCURRENT_READS)
        .try_collect()
        .await
        .ok()?;
    result.sort_by_key(|cue| cue.start_ms);
    if result.iter().map(|c| c.text.len()).sum::<usize>() > MAX_OUTPUT {
        return None;
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_matroska_vints_and_rejects_partial_elements() {
        assert_eq!(vint(&[0x87], 0, false), Some((7, 1)));
        assert_eq!(
            vint(&[0x1f, 0x43, 0xb6, 0x75], 0, true),
            Some((0x1f43b675, 4))
        );
        assert_eq!(vint(&[0x40, 0x10], 0, false), Some((16, 2)));
        assert_eq!(vint(&[0], 0, false), None);
        assert!(children(&[0xa0, 0x86, 0xa1], 0, 3).is_empty());
    }

    #[test]
    fn decodes_matroska_block_group_with_cluster_header_offset() {
        // A CueRelativePosition is relative to the cluster payload, so
        // the next block may begin after the cluster element header.
        let mut bytes = vec![0; 7];
        // BlockGroup A0 (size 12) -> Block A1 (size 10):
        // track 7, relative timestamp 0, flags 0, UTF8 "Hello!".
        bytes.extend_from_slice(&[
            0xa0, 0x8c, 0xa1, 0x8a, 0x87, 0, 0, 0, b'H', b'e', b'l', b'l', b'o', b'!',
        ]);
        assert_eq!(read_block(&bytes, 7).as_deref(), Some("Hello!"));
        assert!(read_block(&bytes, 8).is_none());
    }

    #[test]
    fn srt_uses_cue_duration_and_can_rebase_for_reference_windows() {
        let cues = vec![SubtitleCue {
            start_ms: 301250,
            end_ms: 303750,
            text: "Line of dialogue".into(),
        }];
        assert!(to_srt(&cues, 0).contains("00:05:01,250 --> 00:05:03,750"));
        assert!(to_srt(&cues, 300000).contains("00:00:01,250 --> 00:00:03,750"));
    }

    #[test]
    fn cue_collection_rejects_an_incomplete_index() {
        assert!(cue_positions(&[0x1c, 0x53, 0xbb, 0x6b, 0x80], 52, 7, 1_000_000).is_none());
    }
}
