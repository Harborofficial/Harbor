#[cfg(windows)]
use std::collections::VecDeque;

use serde::Serialize;

#[derive(Serialize)]
pub struct SongResult {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: String,
    pub link: String,
}

#[tauri::command]
pub async fn recognize_now_playing(
    api_token: String,
    seconds: Option<u32>,
) -> Result<Option<SongResult>, String> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        let secs = seconds.unwrap_or(7).clamp(3, 15);
        let (pcm, sample_rate, channels, bits) =
            tauri::async_runtime::spawn_blocking(move || capture_loopback(secs))
                .await
                .map_err(|e| e.to_string())??;
        ensure_audible(&pcm)?;
        let wav = pcm_to_wav(&pcm, sample_rate, channels, bits)?;
        audd_recognize(wav, api_token).await
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (api_token, seconds);
        Err("Song identification is only supported on Windows and Linux for now".into())
    }
}

#[tauri::command]
pub async fn recognize_now_playing_ai(
    api_key: String,
    model: Option<String>,
    seconds: Option<u32>,
) -> Result<Option<SongResult>, String> {
    #[cfg(any(windows, target_os = "linux"))]
    {
        let secs = seconds.unwrap_or(8).clamp(3, 15);
        let (pcm, sample_rate, channels, bits) =
            tauri::async_runtime::spawn_blocking(move || capture_loopback(secs))
                .await
                .map_err(|e| e.to_string())??;
        ensure_audible(&pcm)?;
        let wav = pcm_to_wav(&pcm, sample_rate, channels, bits)?;
        crate::song_id_gemini::recognize(wav, api_key, model).await
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    {
        let _ = (api_key, model, seconds);
        Err("Song identification is only supported on Windows and Linux for now".into())
    }
}

#[cfg(windows)]
fn capture_loopback(seconds: u32) -> Result<(Vec<u8>, u32, u16, u16), String> {
    use wasapi::*;
    initialize_mta()
        .ok()
        .map_err(|e| format!("COM init failed: {e}"))?;

    let sample_rate = 44100u32;
    let channels = 2u16;
    let bits = 16u16;

    let device = get_default_device(&Direction::Render).map_err(|e| e.to_string())?;
    let mut audio_client = device.get_iaudioclient().map_err(|e| e.to_string())?;

    let format = WaveFormat::new(
        bits as usize,
        bits as usize,
        &SampleType::Int,
        sample_rate as usize,
        channels as usize,
        None,
    );

    let (_default_period, min_period) = audio_client.get_periods().map_err(|e| e.to_string())?;
    audio_client
        .initialize_client(
            &format,
            min_period,
            &Direction::Capture,
            &ShareMode::Shared,
            true,
        )
        .map_err(|e| e.to_string())?;

    let h_event = audio_client
        .set_get_eventhandle()
        .map_err(|e| e.to_string())?;
    let capture_client = audio_client
        .get_audiocaptureclient()
        .map_err(|e| e.to_string())?;
    let blockalign = format.get_blockalign() as usize;

    audio_client.start_stream().map_err(|e| e.to_string())?;

    let target_bytes = sample_rate as usize * seconds as usize * blockalign;
    let mut queue: VecDeque<u8> = VecDeque::new();
    while queue.len() < target_bytes {
        capture_client
            .read_from_device_to_deque(&mut queue)
            .map_err(|e| e.to_string())?;
        if h_event.wait_for_event(2000).is_err() {
            break;
        }
    }
    audio_client.stop_stream().map_err(|e| e.to_string())?;

    let bytes_per_sec = sample_rate as usize * blockalign;
    let got = queue.len();
    if got < target_bytes.min(bytes_per_sec * 4) {
        let secs = got as f32 / bytes_per_sec as f32;
        return Err(format!(
            "Harbor only captured {secs:.1}s before your playback device went quiet. Keep the scene playing while Harbor listens."
        ));
    }

    let pcm: Vec<u8> = queue.into_iter().take(target_bytes).collect();
    Ok((pcm, sample_rate, channels, bits))
}

// Windows records the whole default output device. Pulse can record a single
// sink input, so on Linux we listen to Harbor's own mpv stream and nothing else:
// a call or a browser tab playing in the background never ends up in the clip.
// pipewire-pulse speaks the same protocol, so this covers PipeWire too.
#[cfg(target_os = "linux")]
fn capture_loopback(seconds: u32) -> Result<(Vec<u8>, u32, u16, u16), String> {
    use libpulse_binding::callbacks::ListResult;
    use libpulse_binding::context::{Context, FlagSet as ContextFlags, State as ContextState};
    use libpulse_binding::def::BufferAttr;
    use libpulse_binding::mainloop::standard::Mainloop;
    use libpulse_binding::sample::{Format, Spec};
    use libpulse_binding::stream::{FlagSet as StreamFlags, PeekResult, State as StreamState, Stream};
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;
    use std::time::{Duration, Instant};

    let sample_rate = 44100u32;
    let channels = 2u16;
    let bits = 16u16;
    let bytes_per_sec = sample_rate as usize * channels as usize * (bits as usize / 8);
    let target_bytes = bytes_per_sec * seconds as usize;
    // pipewire-pulse needs a couple of seconds before a monitor stream starts
    // flowing, so the deadline leaves room for that on top of the clip itself.
    let deadline = Instant::now() + Duration::from_secs(u64::from(seconds) + 6);
    let timed_out = || Instant::now() > deadline;

    let mut mainloop = Mainloop::new().ok_or("Couldn't start PulseAudio")?;
    let mut context =
        Context::new(&mainloop, "Harbor song id").ok_or("Couldn't reach PulseAudio")?;
    context
        .connect(None, ContextFlags::NOFLAGS, None)
        .map_err(|e| format!("Couldn't connect to PulseAudio: {e}"))?;
    loop {
        match context.get_state() {
            ContextState::Ready => break,
            ContextState::Failed | ContextState::Terminated => {
                return Err("PulseAudio refused the connection".into())
            }
            _ if timed_out() => return Err("PulseAudio took too long to answer".into()),
            _ => pump(&mut mainloop)?,
        }
    }

    // libmpv plays from inside this process, so its Pulse client carries our own
    // pid. Two Harbor instances therefore never match each other's streams.
    let our_pid = std::process::id().to_string();
    let our_clients = Rc::new(RefCell::new(Vec::<u32>::new()));
    {
        let found = Rc::clone(&our_clients);
        let op = context.introspect().get_client_info_list(move |item| {
            let ListResult::Item(info) = item else { return };
            if info.proplist.get_str("application.process.id").as_deref() == Some(our_pid.as_str())
            {
                found.borrow_mut().push(info.index);
            }
        });
        drain(&mut mainloop, &op, "list clients", &timed_out)?;
    }

    let picked = Rc::new(Cell::new(None::<(u32, u32)>));
    {
        let clients = Rc::clone(&our_clients);
        let found = Rc::clone(&picked);
        let op = context.introspect().get_sink_input_info_list(move |item| {
            let ListResult::Item(info) = item else { return };
            if found.get().is_none()
                && is_our_stream(
                    info.proplist.get_str("application.name").as_deref(),
                    info.client,
                    info.corked,
                    &clients.borrow(),
                )
            {
                found.set(Some((info.index, info.sink)));
            }
        });
        drain(&mut mainloop, &op, "list playback streams", &timed_out)?;
    }
    let (index, sink_index) = picked.get().ok_or(
        "Harbor isn't playing anything right now. Start the scene with sound, then try again.",
    )?;

    // set_monitor_stream only isolates the sink input once the recording stream
    // is on the monitor source of that input's own sink, so resolve it by hand:
    // the default source is usually a microphone, not a monitor at all.
    let monitor = Rc::new(RefCell::new(None::<String>));
    {
        let found = Rc::clone(&monitor);
        let op = context
            .introspect()
            .get_sink_info_by_index(sink_index, move |item| {
                let ListResult::Item(info) = item else { return };
                *found.borrow_mut() = info.monitor_source_name.as_deref().map(str::to_owned);
            });
        drain(&mut mainloop, &op, "resolve the output sink", &timed_out)?;
    }
    let monitor = monitor
        .borrow_mut()
        .take()
        .ok_or("Harbor's audio output has no monitor source to record from")?;

    let spec = Spec {
        format: Format::S16le,
        rate: sample_rate,
        channels: channels as u8,
    };
    let mut stream = Stream::new(&mut context, "Harbor song id", &spec, None)
        .ok_or("Couldn't open a PulseAudio stream")?;
    stream
        .set_monitor_stream(index)
        .map_err(|e| format!("Couldn't attach to Harbor's audio: {e}"))?;
    // Small fragments, otherwise the server hands the data over in chunks of a
    // couple of seconds and the clip ends up late and lopsided.
    let attr = BufferAttr {
        maxlength: u32::MAX,
        tlength: u32::MAX,
        prebuf: u32::MAX,
        minreq: u32::MAX,
        fragsize: (bytes_per_sec / 10) as u32,
    };
    stream
        .connect_record(Some(&monitor), Some(&attr), StreamFlags::ADJUST_LATENCY)
        .map_err(|e| format!("Couldn't start recording Harbor's audio: {e}"))?;
    loop {
        match stream.get_state() {
            StreamState::Ready => break,
            StreamState::Failed | StreamState::Terminated => {
                return Err("PulseAudio closed the recording stream".into())
            }
            _ if timed_out() => return Err("PulseAudio took too long to start recording".into()),
            _ => pump(&mut mainloop)?,
        }
    }

    let mut pcm = Vec::with_capacity(target_bytes);
    while pcm.len() < target_bytes && !timed_out() {
        pump(&mut mainloop)?;
        // PAErr has its own to_string() returning Option<String>, hence format!.
        let read_failed = |e| format!("Couldn't read Harbor's audio: {e}");
        loop {
            match stream.peek().map_err(read_failed)? {
                PeekResult::Empty => break,
                PeekResult::Hole(_) => stream.discard().map_err(read_failed)?,
                PeekResult::Data(chunk) => {
                    pcm.extend_from_slice(chunk);
                    stream.discard().map_err(read_failed)?;
                }
            }
        }
    }
    let _ = stream.disconnect();
    context.disconnect();

    let got = pcm.len();
    if got < target_bytes.min(bytes_per_sec * 4) {
        let secs = got as f32 / bytes_per_sec as f32;
        return Err(format!(
            "Harbor only heard {secs:.1}s of its own audio before playback stopped. Keep the scene playing while Harbor listens."
        ));
    }
    pcm.truncate(target_bytes);
    Ok((pcm, sample_rate, channels, bits))
}

// mpv announces AUDIO_CLIENT_NAME on its sink input, but a second Harbor would
// announce the same thing, so the stream also has to belong to a Pulse client of
// this process. A corked input is paused and carries no audio worth recording.
#[cfg(target_os = "linux")]
fn is_our_stream(
    app_name: Option<&str>,
    client: Option<u32>,
    corked: bool,
    our_clients: &[u32],
) -> bool {
    !corked
        && app_name == Some(crate::mpv::AUDIO_CLIENT_NAME)
        && client.is_some_and(|c| our_clients.contains(&c))
}

// Introspection answers arrive on the mainloop, so every query needs pumping
// until it settles; the deadline keeps a wedged server from hanging the capture.
#[cfg(target_os = "linux")]
fn drain<T: ?Sized>(
    mainloop: &mut libpulse_binding::mainloop::standard::Mainloop,
    op: &libpulse_binding::operation::Operation<T>,
    what: &str,
    timed_out: &impl Fn() -> bool,
) -> Result<(), String> {
    use libpulse_binding::operation::State;
    while op.get_state() == State::Running {
        if timed_out() {
            return Err(format!("PulseAudio took too long to {what}"));
        }
        pump(mainloop)?;
    }
    Ok(())
}

// Never blocks, so a stalled server can't hold the capture past its deadline.
#[cfg(target_os = "linux")]
fn pump(mainloop: &mut libpulse_binding::mainloop::standard::Mainloop) -> Result<(), String> {
    use libpulse_binding::mainloop::standard::IterateResult;
    match mainloop.iterate(false) {
        IterateResult::Success(0) => {
            std::thread::sleep(std::time::Duration::from_millis(10));
            Ok(())
        }
        IterateResult::Success(_) => Ok(()),
        IterateResult::Quit(_) | IterateResult::Err(_) => {
            Err("PulseAudio stopped responding".into())
        }
    }
}

#[cfg(windows)]
const SILENCE_HINT: &str = "Harbor heard silence on your default playback device. Play the scene with sound, and make sure Windows is playing it through the device set as default.";
#[cfg(target_os = "linux")]
const SILENCE_HINT: &str =
    "Harbor heard silence from its own player. Play the scene with sound, and make sure Harbor isn't muted.";

#[cfg(any(windows, target_os = "linux"))]
fn ensure_audible(pcm: &[u8]) -> Result<(), String> {
    let peak = pcm
        .chunks_exact(2)
        .map(|c| (i16::from_le_bytes([c[0], c[1]]) as i32).abs())
        .max()
        .unwrap_or(0);
    if peak < 150 {
        return Err(SILENCE_HINT.to_string());
    }
    Ok(())
}

#[cfg(any(windows, target_os = "linux"))]
fn pcm_to_wav(pcm: &[u8], sample_rate: u32, channels: u16, bits: u16) -> Result<Vec<u8>, String> {
    use hound::{SampleFormat, WavSpec, WavWriter};
    use std::io::Cursor;

    let spec = WavSpec {
        channels,
        sample_rate,
        bits_per_sample: bits,
        sample_format: SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::<u8>::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec).map_err(|e| e.to_string())?;
        for chunk in pcm.chunks_exact(2) {
            let s = i16::from_le_bytes([chunk[0], chunk[1]]);
            writer.write_sample(s).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}

#[cfg(any(windows, target_os = "linux"))]
async fn audd_recognize(wav: Vec<u8>, api_token: String) -> Result<Option<SongResult>, String> {
    use reqwest::multipart::{Form, Part};

    let part = Part::bytes(wav)
        .file_name("clip.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let form = Form::new()
        .text("api_token", api_token)
        .text("return", "apple_music,spotify")
        .part("file", part);

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.audd.io/")
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if json["status"] != "success" {
        let msg = json["error"]["error_message"]
            .as_str()
            .unwrap_or("unknown error");
        return Err(format!("AudD: {msg}"));
    }

    let r = &json["result"];
    if r.is_null() {
        return Ok(None);
    }

    let title = r["title"].as_str().unwrap_or("").to_string();
    let artist = r["artist"].as_str().unwrap_or("").to_string();
    let album = r["album"].as_str().unwrap_or("").to_string();
    let link = r["song_link"].as_str().unwrap_or("").to_string();

    let mut artwork = String::new();
    if let Some(u) = r["apple_music"]["artwork"]["url"].as_str() {
        artwork = u.replace("{w}", "300").replace("{h}", "300");
    } else if let Some(u) = r["spotify"]["album"]["images"][0]["url"].as_str() {
        artwork = u.to_string();
    }

    Ok(Some(SongResult {
        title,
        artist,
        album,
        artwork,
        link,
    }))
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::is_our_stream;
    use crate::mpv::AUDIO_CLIENT_NAME;

    const OURS: &[u32] = &[7, 9];

    #[test]
    fn picks_our_own_playing_stream() {
        assert!(is_our_stream(Some(AUDIO_CLIENT_NAME), Some(7), false, OURS));
    }

    #[test]
    fn skips_a_paused_stream() {
        assert!(!is_our_stream(Some(AUDIO_CLIENT_NAME), Some(7), true, OURS));
    }

    #[test]
    fn skips_another_harbor_instance() {
        // Same client name, different process, so a different Pulse client.
        assert!(!is_our_stream(Some(AUDIO_CLIENT_NAME), Some(42), false, OURS));
    }

    #[test]
    fn skips_other_applications_and_our_own_webview() {
        // The WebView registers as "harbor", lowercase, from a child process.
        assert!(!is_our_stream(Some("harbor"), Some(7), false, OURS));
        assert!(!is_our_stream(Some("Spotify"), Some(7), false, OURS));
        assert!(!is_our_stream(None, Some(7), false, OURS));
    }

    #[test]
    fn skips_a_stream_with_no_client() {
        assert!(!is_our_stream(Some(AUDIO_CLIENT_NAME), None, false, OURS));
    }
}
