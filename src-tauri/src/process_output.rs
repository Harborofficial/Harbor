use std::io;
use std::process::{Command, Output};

/// Runs a child process without asking Tokio to adapt Rust's overlapped Windows
/// process pipes to synchronous reads. `std::process::Command::output` uses the
/// standard library's matching pipe implementation.
pub async fn output(mut command: Command) -> io::Result<Output> {
    tokio::task::spawn_blocking(move || command.output())
        .await
        .map_err(|error| io::Error::new(io::ErrorKind::Other, error))?
}
