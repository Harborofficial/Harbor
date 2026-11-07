use ndarray::{Array2, Array3, ArrayD, Ix3};
use ort::session::Session;
use ort::value::Tensor;
use std::sync::{Mutex, OnceLock};

const MODEL: &[u8] = include_bytes!("../models/silero_vad.onnx");
const CTX: usize = 64;
const WIN: usize = 512;

fn session() -> Result<&'static Mutex<Session>, String> {
    static S: OnceLock<Mutex<Session>> = OnceLock::new();
    if let Some(s) = S.get() {
        return Ok(s);
    }
    let sess = Session::builder()
        .and_then(|b| b.with_intra_threads(1))
        .and_then(|b| b.with_inter_threads(1))
        .and_then(|b| b.commit_from_memory(MODEL))
        .map_err(|e| format!("silero load: {}", e))?;
    let _ = S.set(Mutex::new(sess));
    S.get().ok_or_else(|| "silero cell".into())
}

pub fn probs(pcm: &[f32]) -> Result<Vec<f32>, String> {
    let cell = session()?;
    let mut sess = cell.lock().map_err(|_| "silero poisoned")?;
    let mut state = Array3::<f32>::zeros((2, 1, 128));
    let mut context = vec![0f32; CTX];
    let mut out = Vec::new();
    for chunk in pcm.chunks(WIN) {
        if chunk.len() < WIN {
            break;
        }
        let mut frame = Vec::with_capacity(CTX + WIN);
        frame.extend_from_slice(&context);
        frame.extend_from_slice(chunk);
        let input = Array2::from_shape_vec((1, CTX + WIN), frame)
            .map_err(|e| format!("input shape: {}", e))?;
        let sr = Tensor::from_array(([1usize], vec![16000i64])).map_err(|e| e.to_string())?;
        let outputs = sess
            .run(ort::inputs![
                "input" => Tensor::from_array(input).map_err(|e| e.to_string())?,
                "state" => Tensor::from_array(state.clone()).map_err(|e| e.to_string())?,
                "sr" => sr,
            ])
            .map_err(|e| format!("silero run: {}", e))?;
        let prob = outputs["output"]
            .try_extract_array::<f32>()
            .map_err(|e| e.to_string())?;
        out.push(prob.iter().copied().next().unwrap_or(0.0));
        let ns: ArrayD<f32> = outputs["stateN"]
            .try_extract_array::<f32>()
            .map_err(|e| e.to_string())?
            .to_owned();
        state = ns.into_dimensionality::<Ix3>().map_err(|e| e.to_string())?;
        context.copy_from_slice(&chunk[WIN - CTX..]);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn silence_is_not_speech_and_each_clip_resets_recurrent_state() {
        let pcm = vec![0.0; 16_000];
        let first = super::probs(&pcm).expect("bundled Silero model loads");
        let second = super::probs(&pcm).expect("cached session runs");
        assert_eq!(first.len(), 16_000 / super::WIN);
        assert_eq!(first, second);
        assert!(first
            .iter()
            .all(|p| p.is_finite() && (0.0..0.55).contains(p)));
    }
}
