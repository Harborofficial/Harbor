mod commands;
mod locate;
mod runtime;

use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--describe"] {
        println!(
            "{}",
            json!({"kind":"harbor-extensions","abi":2,"version":env!("CARGO_PKG_VERSION")})
        );
        return Ok(());
    }
    if args.len() != 6
        || args[0] != "--abi"
        || args[1] != "2"
        || args[2] != "--host-version"
        || args[3] != env!("CARGO_PKG_VERSION")
        || args[4] != "--data-dir"
    {
        return Err("incompatible Extensions module interface or host version".into());
    }
    let data = PathBuf::from(&args[5]);
    if !data.is_absolute() {
        return Err("extension data directory must be absolute".into());
    }
    let mut input = BufReader::new(tokio::io::stdin()).lines();
    if input
        .next_line()
        .await
        .map_err(|e| e.to_string())?
        .as_deref()
        != Some("start")
    {
        return Err("Extensions host did not authorize startup".into());
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let root = exe.parent().ok_or("Module has no directory")?.to_path_buf();
    let (output, mut frames) = tokio::sync::mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(frame) = frames.recv().await {
            stdout.write_all(format!("{frame}\n").as_bytes()).await?;
            stdout.flush().await?;
        }
        Ok::<(), std::io::Error>(())
    });
    let host = Arc::new(runtime::Host::new(output.clone()));
    let runtime = Arc::new(runtime::Runtime::new(host.clone(), root, data));
    let mut calls = tokio::task::JoinSet::new();
    loop {
        let line = tokio::select! {
            Some(_) = calls.join_next(), if !calls.is_empty() => continue,
            line = input.next_line() => line.map_err(|e| e.to_string())?,
        };
        let Some(line) = line else {
            break;
        };
        let frame: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if let Some(command) = frame["command"].as_str() {
            let request = commands::prepare(command, frame.get("args").unwrap_or(&json!({})));
            let id = frame["id"].clone();
            let runtime = runtime.clone();
            let output = output.clone();
            calls.spawn(async move {
                let result = match request {
                    Ok(request) => runtime.call(request).await,
                    Err(error) => Err(error),
                };
                let reply = match result {
                    Ok(result) => json!({"id":id,"result":result}),
                    Err(error) => json!({"id":id,"error":error}),
                };
                let _ = output.send(reply);
            });
        } else {
            host.answer(frame);
        }
    }
    calls.abort_all();
    while calls.join_next().await.is_some() {}
    runtime.shutdown().await;
    drop(runtime);
    drop(host);
    drop(output);
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), writer).await;
    Ok(())
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("[extensions-module] {error}");
        std::process::exit(1);
    }
}
