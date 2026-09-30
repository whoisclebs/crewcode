//! Starts the server that the interface talks to, unless one is already running at `CREWCODE_URL`.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};

use crate::core;

/// A server this process started, stopped when the value is dropped.
pub struct Spawned {
    child: Child,
    pub url: String,
    /// Only this process knows it, so nothing else on the machine can use the server.
    pub password: String,
}

impl Drop for Spawned {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 128 random bits as hex. `RandomState` is seeded by the operating system for every process.
fn random_password() -> String {
    (0..2)
        .map(|_| {
            let mut hasher = RandomState::new().build_hasher();
            hasher.write_u128(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_nanos()),
            );
            format!("{:016x}", hasher.finish())
        })
        .collect()
}

/// Runs the core as a server on a free port and waits for the address it prints once it is listening.
pub fn spawn() -> Result<Spawned, String> {
    let launch = core::locate().map_err(|e| e.to_string())?;
    let password = random_password();
    let mut child = core::command(
        &launch,
        &["serve".to_owned(), "--port".to_owned(), "0".to_owned()],
    )
    .env("CREWCODE_SERVER_PASSWORD", &password)
    .env("CREWCODE_SERVER_USERNAME", "crewcode")
    .env("CREWCODE_EXIT_WITH_PARENT", std::process::id().to_string())
    .stdout(Stdio::piped())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| format!("cannot start the server: {e}"))?;
    let stdout = child.stdout.take().ok_or("no server output")?;
    let mut lines = BufReader::new(stdout).lines();
    let url = loop {
        let Some(line) = lines.next() else {
            return Err("the server exited before it was listening".to_owned());
        };
        let line = line.map_err(|e| e.to_string())?;
        if let Some(url) = line
            .split_whitespace()
            .find(|word| word.starts_with("http://"))
        {
            break url.to_owned();
        }
    };
    // Keep reading so the server never blocks on a full pipe.
    std::thread::spawn(move || lines.for_each(drop));
    Ok(Spawned {
        child,
        url,
        password,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_are_long_hex_and_differ_between_calls() {
        let (a, b) = (random_password(), random_password());
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
