use std::io::{self, Read};
use std::process::{Child, Command, Output, Stdio};
use std::time::Duration;

/// Runs a child process to completion and kills it when `timeout` elapses.
///
/// Rust's Windows child pipes are opened in overlapped mode. Reading them through
/// Tokio's process adapter makes the standard library abort the whole application
/// when a read never completes synchronously (`0xC0000409`,
/// `fatal runtime error: I/O error: operation failed to complete synchronously`).
/// Reading the piped handles with the standard library on a blocking thread avoids
/// that path, while the [`Child`] stays owned here so the timeout still bounds the
/// lifetime of the process instead of only the wait for its output.
pub async fn output(mut command: Command, timeout: Duration) -> io::Result<Output> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    let collected = tokio::time::timeout(timeout, async move {
        let stdout = tokio::task::spawn_blocking(move || read_to_end(stdout));
        let stderr = tokio::task::spawn_blocking(move || read_to_end(stderr));
        let (stdout, stderr) = tokio::join!(stdout, stderr);
        let stdout = stdout.map_err(join_error)??;
        let stderr = stderr.map_err(join_error)??;
        Ok::<_, io::Error>((stdout, stderr))
    })
    .await;

    match collected {
        Ok(Ok((stdout, stderr))) => {
            let status = child.wait()?;
            Ok(Output {
                status,
                stdout,
                stderr,
            })
        }
        Ok(Err(error)) => {
            kill_and_reap(&mut child);
            Err(error)
        }
        Err(_) => {
            kill_and_reap(&mut child);
            Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "child process timed out",
            ))
        }
    }
}

fn read_to_end(mut pipe: impl Read) -> io::Result<Vec<u8>> {
    let mut buffer = Vec::new();
    pipe.read_to_end(&mut buffer)?;
    Ok(buffer)
}

fn join_error(error: tokio::task::JoinError) -> io::Error {
    io::Error::new(io::ErrorKind::Other, error)
}

fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}
