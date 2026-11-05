use std::io::{self, Read};
use std::process::{Child, Command, ExitStatus, Output, Stdio};
use std::time::Duration;

/// Runs a child process to completion and kills it when `timeout` elapses.
///
/// Rust's Windows child pipes are opened in overlapped mode. Reading them through
/// Tokio's process adapter makes the standard library abort the whole application
/// when a read never completes synchronously (`0xC0000409`,
/// `fatal runtime error: I/O error: operation failed to complete synchronously`).
/// Reading the piped handles with the standard library on a blocking thread avoids
/// that path, while the [`Child`] stays owned here so the timeout can bound the
/// whole lifetime of the process: the pipe reads and the final exit wait share one
/// deadline, and every timeout path kills and reaps the child.
pub async fn output(mut command: Command, timeout: Duration) -> io::Result<Output> {
    let deadline = tokio::time::Instant::now() + timeout;

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");

    let collected = tokio::time::timeout_at(deadline, async move {
        let stdout = tokio::task::spawn_blocking(move || read_to_end(stdout));
        let stderr = tokio::task::spawn_blocking(move || read_to_end(stderr));
        let (stdout, stderr) = tokio::join!(stdout, stderr);
        let stdout = stdout.map_err(join_error)??;
        let stderr = stderr.map_err(join_error)??;
        Ok::<_, io::Error>((stdout, stderr))
    })
    .await;

    let (stdout, stderr) = match collected {
        Ok(Ok(buffers)) => buffers,
        Ok(Err(error)) => {
            kill_and_reap(&mut child);
            return Err(error);
        }
        Err(_) => {
            kill_and_reap(&mut child);
            return Err(timed_out());
        }
    };

    // The reads can finish while the process is still alive: it may close its
    // output handles and keep running. The exit is therefore bounded by the same
    // deadline instead of blocking on `Child::wait`.
    match wait_until(&mut child, deadline).await {
        Ok(status) => Ok(Output {
            status,
            stdout,
            stderr,
        }),
        Err(error) => {
            kill_and_reap(&mut child);
            Err(error)
        }
    }
}

/// Polls [`Child::try_wait`] until the child exits or `deadline` passes.
async fn wait_until(child: &mut Child, deadline: tokio::time::Instant) -> io::Result<ExitStatus> {
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(timed_out());
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn timed_out() -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "child process timed out")
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

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const CHILD_ENV: &str = "HARBOR_CHILD_STDIO_TEST";
    const STD_OUTPUT_HANDLE: u32 = -11i32 as u32;
    const STD_ERROR_HANDLE: u32 = -12i32 as u32;

    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(handle: u32) -> *mut core::ffi::c_void;
        fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    }

    /// Child half of `kills_child_that_closes_pipes_but_keeps_running`: closes its
    /// output handles so the parent sees EOF, then keeps running.
    #[test]
    fn child_closes_stdout_and_stderr_then_hangs() {
        if std::env::var_os(CHILD_ENV).is_none() {
            return;
        }
        // SAFETY: plain Win32 handle calls; the handles are the process' own
        // standard handles and are closed once for the lifetime of this child.
        unsafe {
            CloseHandle(GetStdHandle(STD_OUTPUT_HANDLE));
            CloseHandle(GetStdHandle(STD_ERROR_HANDLE));
        }
        std::thread::sleep(Duration::from_secs(30));
    }

    #[tokio::test]
    async fn kills_child_that_closes_pipes_but_keeps_running() {
        let mut command = Command::new(std::env::current_exe().expect("test binary"));
        command
            .args([
                "--exact",
                "process_output::tests::child_closes_stdout_and_stderr_then_hangs",
                "--nocapture",
            ])
            .env(CHILD_ENV, "1");

        let started = Instant::now();
        let error = output(command, Duration::from_secs(2))
            .await
            .expect_err("the helper must time out instead of blocking on the child exit");

        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "helper returned after {:?} instead of the configured 2s budget",
            started.elapsed()
        );
    }
}
