//! Deterministic test backend, never staged or shipped.
use serde_json::{json, Value};
use std::{
    io::{self, BufRead, Write},
    path::PathBuf,
};
fn emit(frame: Value) {
    println!("{frame}");
    io::stdout().flush().unwrap();
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    if args.iter().any(|s| s == "-version") {
        return;
    }
    let data = PathBuf::from(args.last().unwrap());
    std::fs::create_dir_all(&data).unwrap();
    let mut challenge_request = Value::Null;
    for line in io::stdin().lock().lines() {
        let frame: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let id = frame["id"].clone();
        if id == "challenge-fixture" {
            emit(if frame["ok"] == true {
                json!({"id":challenge_request,"ok":true,"result":frame["result"]})
            } else {
                json!({"id":challenge_request,"ok":false,"error":frame["error"]})
            });
            continue;
        }
        match frame["method"].as_str().unwrap_or("") {
            "search" if frame["params"]["query"] == "retry" => {
                let marker = data.join("read-attempts");
                let count = std::fs::read_to_string(&marker)
                    .ok()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0)
                    + 1;
                std::fs::write(marker, count.to_string()).unwrap();
                if count == 1 {
                    std::process::exit(1);
                }
                emit(json!({"id":id,"ok":true,"result":{"attempts":count}}));
            }
            "install" => {
                let marker = data.join("mutation-attempts");
                let count = std::fs::read_to_string(&marker)
                    .ok()
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0)
                    + 1;
                std::fs::write(marker, count.to_string()).unwrap();
                std::process::exit(1);
            }
            "load" => {
                challenge_request = id;
                let method = if frame["params"]["url"] == "unknown" {
                    "unrecognized"
                } else {
                    "challenge"
                };
                emit(
                    json!({"id":"challenge-fixture","host":method,"params":{"url":"https://example.test/challenge"}}),
                );
            }
            _ => emit(json!({"id":id,"ok":true,"result":{"pong":true,"params":frame["params"]}})),
        }
    }
}
