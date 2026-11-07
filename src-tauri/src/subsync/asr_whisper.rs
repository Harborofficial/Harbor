#![cfg(feature = "asr-whisper")]

use super::asr::{AsrEngine, AsrSegment, AsrToken, ASR_SAMPLE_RATE};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct WhisperEngine {
    ctx: WhisperContext,
    n_threads: i32,
}

fn clip_interval(start: f32, end: f32, duration: f32) -> Option<(f32, f32)> {
    if !start.is_finite() || !end.is_finite() {
        return None;
    }
    let start = start.max(0.0);
    let end = end.min(duration);
    (end > start).then_some((start, end))
}

// Whisper's BPE tokens can split a single Unicode character into byte fragments.
// Decode complete groups instead of dropping fragments as invalid UTF-8; the
// resulting speech token retains the full group's timing and lowest confidence.
fn decode_token_bytes(pieces: impl IntoIterator<Item = (Vec<u8>, f32, f32, f32)>) -> Vec<AsrToken> {
    let mut tokens = Vec::new();
    let mut pending = Vec::new();
    let mut start = 0.0_f32;
    let mut end = 0.0_f32;
    let mut confidence = 1.0_f32;
    for (bytes, t0, t1, p) in pieces {
        if bytes.starts_with(b"[_") || bytes.starts_with(b"<|") {
            pending.clear();
            continue;
        }
        if bytes.is_empty() {
            continue;
        }
        if pending.is_empty() {
            start = t0;
            end = t1;
            confidence = p;
        } else {
            start = start.min(t0);
            end = end.max(t1);
            confidence = confidence.min(p);
        }
        pending.extend(bytes);
        match std::str::from_utf8(&pending) {
            Ok(text) => {
                tokens.push(AsrToken {
                    text: text.to_owned(),
                    t0: start,
                    t1: end,
                    p: confidence,
                });
                pending.clear();
            }
            Err(error) if error.error_len().is_none() => {}
            Err(_) => pending.clear(),
        }
    }
    tokens
}

impl WhisperEngine {
    pub fn load(model_path: &str) -> Result<Self, String> {
        let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
            .map_err(|e| format!("load model: {}", e))?;
        let n_threads = std::thread::available_parallelism()
            .map(|v| v.get() as i32)
            .unwrap_or(4)
            .min(8);
        Ok(Self { ctx, n_threads })
    }

    fn params<'a>(&self, lang: Option<&'a str>, translate: bool) -> FullParams<'a, 'a> {
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_n_threads(self.n_threads);
        p.set_translate(translate);
        p.set_no_context(true);
        p.set_single_segment(false);
        p.set_token_timestamps(true);
        p.set_max_len(1);
        p.set_split_on_word(true);
        p.set_temperature(0.0);
        p.set_suppress_blank(true);
        p.set_suppress_nst(true);
        p.set_no_speech_thold(0.6);
        p.set_print_special(false);
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_timestamps(false);
        if let Some(l) = lang {
            p.set_language(Some(l));
        }
        p
    }
}

impl AsrEngine for WhisperEngine {
    fn transcribe(
        &self,
        pcm: &[f32],
        lang: Option<&str>,
        translate: bool,
    ) -> Result<Vec<AsrSegment>, String> {
        if pcm.len() < ASR_SAMPLE_RATE as usize {
            return Ok(Vec::new());
        }
        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| format!("state: {}", e))?;
        let params = self.params(lang, translate);
        state
            .full(params, pcm)
            .map_err(|e| format!("full: {}", e))?;
        let n = state
            .full_n_segments()
            .map_err(|e| format!("nseg: {}", e))?;
        let duration = pcm.len() as f32 / ASR_SAMPLE_RATE as f32;
        let mut out = Vec::with_capacity(n as usize);
        for i in 0..n {
            let text = state.full_get_segment_text(i).unwrap_or_default();
            let t0 = state.full_get_segment_t0(i).unwrap_or(0) as f32 / 100.0;
            let t1 = state.full_get_segment_t1(i).unwrap_or(0) as f32 / 100.0;
            let Some((t0, t1)) = clip_interval(t0, t1, duration) else {
                continue;
            };
            let mut pieces = Vec::new();
            // whisper-rs 0.14 does not expose a per-segment no-speech score.
            // Keep the existing neutral fallback rather than calling a missing API.
            let no_speech = 0.0;
            if let Ok(nt) = state.full_n_tokens(i) {
                for j in 0..nt {
                    let td = match state.full_get_token_data(i, j) {
                        Ok(d) => d,
                        Err(_) => continue,
                    };
                    let bytes = state.full_get_token_bytes(i, j).unwrap_or_default();
                    pieces.push((bytes, td.t0 as f32 / 100.0, td.t1 as f32 / 100.0, td.p));
                }
            }
            out.push(AsrSegment {
                text,
                t0,
                t1,
                no_speech,
                // Decoding can extend the final timestamp beyond the input clip.
                // Such time cannot be evidence about speech in the source audio.
                tokens: decode_token_bytes(pieces)
                    .into_iter()
                    .filter_map(|mut token| {
                        let (start, end) = clip_interval(token.t0, token.t1, duration)?;
                        token.t0 = start;
                        token.t1 = end;
                        Some(token)
                    })
                    .collect(),
            });
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognition_timestamps_cannot_extend_past_the_input_audio() {
        assert_eq!(clip_interval(30.0, 42.84, 35.0), Some((30.0, 35.0)));
        assert_eq!(clip_interval(36.0, 42.84, 35.0), None);
        assert_eq!(clip_interval(-1.0, 1.0, 35.0), Some((0.0, 1.0)));
        assert_eq!(clip_interval(2.0, 1.0, 35.0), None);
        assert_eq!(clip_interval(1.0, 1.0, 35.0), None);
        assert_eq!(clip_interval(f32::NAN, 1.0, 35.0), None);
        assert_eq!(clip_interval(1.0, f32::INFINITY, 35.0), None);
    }

    #[test]
    fn split_korean_bytes_keep_their_complete_timing() {
        let bytes = "죽".as_bytes();
        let tokens = decode_token_bytes([
            (bytes[..1].to_vec(), 1.0, 1.2, 0.9),
            (bytes[1..].to_vec(), 1.2, 1.5, 0.7),
            (b" word".to_vec(), 1.6, 2.0, 0.8),
        ]);
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].text, "죽");
        assert_eq!((tokens[0].t0, tokens[0].t1, tokens[0].p), (1.0, 1.5, 0.7));
        assert_eq!(tokens[1].text, " word");
    }

    #[test]
    fn special_tokens_do_not_join_unfinished_text_across_boundaries() {
        let tokens = decode_token_bytes([
            (vec![0xe3], 0.0, 0.1, 0.9),
            (b"[_EOT_]".to_vec(), 0.1, 0.2, 1.0),
            ("日本語".as_bytes().to_vec(), 1.0, 2.0, 0.8),
        ]);
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].text, "日本語");
        assert_eq!((tokens[0].t0, tokens[0].t1), (1.0, 2.0));
    }
}
