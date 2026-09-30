//! Opening a link in the user's browser.

use std::process::{Command, Stdio};

/// The programs that open a link on this system, most likely first.
fn openers() -> Vec<Vec<&'static str>> {
    if cfg!(target_os = "macos") {
        vec![vec!["open"]]
    } else if cfg!(windows) {
        vec![vec!["cmd", "/c", "start", ""]]
    } else {
        vec![vec!["xdg-open"], vec!["wslview"], vec!["sensible-browser"]]
    }
}

/// Opens `url` in the default browser.
pub fn open(url: &str) -> Result<(), String> {
    for opener in openers() {
        let started = Command::new(opener[0])
            .args(&opener[1..])
            .arg(url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
        if started.is_ok() {
            return Ok(());
        }
    }
    Err("no browser could be opened, so copy the link instead".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_system_has_at_least_one_way_to_open_a_link() {
        assert!(openers().iter().all(|opener| !opener.is_empty()));
        assert!(!openers().is_empty());
    }
}
