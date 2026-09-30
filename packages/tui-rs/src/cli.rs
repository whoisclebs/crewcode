//! What the command line asks for: the terminal interface, or one of the server's commands.
//!
//! `crewcode` alone, `crewcode <project>` and the interface options start the interface; `crewcode attach <url>`
//! starts it on a server that is already running. Every other command (`run`, `serve`, `providers`, ...) is the
//! server's own and is passed on untouched.

use std::path::Path;

/// How to start the interface.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Start {
    /// A project directory to work in instead of the current one.
    pub directory: Option<String>,
    /// `provider/model` for the first messages.
    pub model: Option<String>,
    pub agent: Option<String>,
    /// Open the latest session of this directory.
    pub continue_last: bool,
    /// Open this session.
    pub session: Option<String>,
    /// Open a copy of the session instead of the session itself.
    pub fork: bool,
    /// A message to send as soon as the interface is up.
    pub prompt: Option<String>,
    /// A server that is already running, instead of starting one.
    pub attach: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Invocation {
    Interface(Start),
    /// A command of the server, with its arguments.
    Core(Vec<String>),
    Version,
    /// `--help`: what the interface adds, then the server's own help.
    Help(Vec<String>),
}

/// The interface options, for `--help`.
pub const INTERFACE_HELP: &str = "crewcode [project]          start the interface
crewcode attach <url>       start the interface on a server that is already running

Interface options:
  -c, --continue            continue the latest session of the directory
  -s, --session <id>        continue this session
      --fork                open a copy of the session (with --continue or --session)
  -m, --model <p/model>     model to use, as provider/model
      --agent <name>        agent to use
      --prompt <text>       message to send as soon as the interface is up

";

fn value(args: &[String], at: usize, flag: &str) -> Result<String, String> {
    args.get(at)
        .cloned()
        .ok_or_else(|| format!("{flag} needs a value"))
}

/// Splits `--flag=value` into its parts.
fn split_equals(arg: &str) -> (&str, Option<&str>) {
    match arg.split_once('=') {
        Some((flag, value)) if flag.starts_with("--") => (flag, Some(value)),
        _ => (arg, None),
    }
}

/// Reads the command line. `Err` is a message for the user.
pub fn parse(args: &[String]) -> Result<Invocation, String> {
    if matches!(args.first().map(String::as_str), Some("--version" | "-v")) {
        return Ok(Invocation::Version);
    }
    if args.iter().any(|a| a == "--help" || a == "-h")
        && args.iter().all(|a| a.starts_with('-') || a == "--help")
    {
        return Ok(Invocation::Help(args.to_vec()));
    }
    let mut start = Start::default();
    let mut rest = args;
    if args.first().map(String::as_str) == Some("attach") {
        start.attach = Some(value(args, 1, "attach")?);
        rest = &args[2..];
    }
    let mut at = 0;
    while at < rest.len() {
        let (flag, inline) = split_equals(&rest[at]);
        let take = |at: &mut usize| -> Result<String, String> {
            match inline {
                Some(v) => Ok(v.to_owned()),
                None => {
                    *at += 1;
                    value(rest, *at, flag)
                }
            }
        };
        match flag {
            "-c" | "--continue" => start.continue_last = true,
            "--fork" => start.fork = true,
            "-s" | "--session" => start.session = Some(take(&mut at)?),
            "-m" | "--model" => start.model = Some(take(&mut at)?),
            "--agent" => start.agent = Some(take(&mut at)?),
            "--prompt" => start.prompt = Some(take(&mut at)?),
            positional
                if !positional.starts_with('-')
                    && start.directory.is_none()
                    && Path::new(positional).is_dir() =>
            {
                start.directory = Some(positional.to_owned());
            }
            _ => return Ok(Invocation::Core(args.to_vec())),
        }
        at += 1;
    }
    if start.fork && !start.continue_last && start.session.is_none() {
        return Err("--fork needs --continue or --session".to_owned());
    }
    Ok(Invocation::Interface(start))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    fn interface(list: &[&str]) -> Start {
        match parse(&args(list)).unwrap() {
            Invocation::Interface(start) => start,
            other => panic!("expected the interface, got {other:?}"),
        }
    }

    #[test]
    fn no_arguments_start_the_interface() {
        assert_eq!(interface(&[]), Start::default());
    }

    #[test]
    fn the_interface_options_are_read_in_short_long_and_equals_forms() {
        let start = interface(&[
            "-c",
            "-m",
            "openai/gpt",
            "--agent=plan",
            "--prompt",
            "fix it",
        ]);
        assert!(start.continue_last);
        assert_eq!(
            (
                start.model.as_deref(),
                start.agent.as_deref(),
                start.prompt.as_deref()
            ),
            (Some("openai/gpt"), Some("plan"), Some("fix it"))
        );
        assert_eq!(
            interface(&["--session=ses_1", "--fork"]).session.as_deref(),
            Some("ses_1")
        );
    }

    #[test]
    fn a_directory_is_the_project() {
        assert_eq!(interface(&["."]).directory.as_deref(), Some("."));
    }

    #[test]
    fn server_commands_and_unknown_options_go_to_the_core_untouched() {
        for list in [
            &["run", "hello"][..],
            &["serve", "--port", "0"],
            &["providers", "login"],
            &["--print-logs"],
            &["-m", "a/b", "run"],
        ] {
            assert_eq!(
                parse(&args(list)).unwrap(),
                Invocation::Core(args(list)),
                "{list:?}"
            );
        }
    }

    #[test]
    fn attach_starts_the_interface_on_a_running_server() {
        let start = interface(&["attach", "http://10.0.0.2:4096", "-s", "ses_9"]);
        assert_eq!(
            (start.attach.as_deref(), start.session.as_deref()),
            (Some("http://10.0.0.2:4096"), Some("ses_9"))
        );
        assert!(parse(&args(&["attach"])).is_err());
    }

    #[test]
    fn a_fork_needs_something_to_fork() {
        assert!(parse(&args(&["--fork"])).is_err());
        assert!(parse(&args(&["--fork", "-c"])).is_ok());
    }

    #[test]
    fn an_option_without_its_value_is_an_error_not_a_panic() {
        assert!(parse(&args(&["--model"])).is_err());
        assert!(parse(&args(&["-s"])).is_err());
    }

    #[test]
    fn version_and_help_are_recognized() {
        assert_eq!(parse(&args(&["--version"])).unwrap(), Invocation::Version);
        assert_eq!(
            parse(&args(&["-h"])).unwrap(),
            Invocation::Help(args(&["-h"]))
        );
        assert_eq!(
            parse(&args(&["run", "--help"])).unwrap(),
            Invocation::Core(args(&["run", "--help"]))
        );
    }
}
