//! The CrewCode terminal interface, built on CrewTUI.

mod app;
mod browser;
mod builtin_themes;
mod cli;
mod client;
mod connect;
mod core;
mod dialogs;
mod picker;
mod prompt;
mod server;
mod store;
#[cfg(test)]
mod tests;
mod theme;
mod themes;
mod transcript;
mod view;

use std::io::{self, IsTerminal};
use std::process::ExitCode;

use app::CrewCode;
use cli::{Invocation, Start};
use client::Client;
use crewtui::{Program, TerminalOptions};
use store::Store;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match cli::parse(&args) {
        Err(message) => {
            eprintln!("crewcode: {message}");
            return ExitCode::from(2);
        }
        Ok(Invocation::Version) => {
            println!("crewcode {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Ok(Invocation::Help(args)) => {
            print!("{}", cli::INTERFACE_HELP);
            core::passthrough(&args).map(exit_code)
        }
        Ok(Invocation::Core(args)) => core::passthrough(&args).map(exit_code),
        Ok(Invocation::Interface(start)) => run_interface(start),
    };
    match result {
        Ok(code) => code,
        Err(error) => {
            eprintln!("crewcode: {error}");
            ExitCode::FAILURE
        }
    }
}

fn exit_code(code: i32) -> ExitCode {
    u8::try_from(code).map_or(ExitCode::FAILURE, ExitCode::from)
}

/// Starts the terminal interface as the command line asked.
fn run_interface(start: Start) -> io::Result<ExitCode> {
    if !std::io::stdin().is_terminal() {
        return Err(io::Error::other(
            "the interface needs a terminal; for piped input use `crewcode run`",
        ));
    }
    if let Some(directory) = &start.directory {
        std::env::set_current_dir(directory)?;
    }
    let directory = std::env::current_dir()?.to_string_lossy().into_owned();
    let client = Client::from_env(directory);
    let remote = start
        .attach
        .clone()
        .or_else(|| std::env::var("CREWCODE_URL").ok());
    let (client, spawned) = match remote {
        Some(url) => (client.with_url(&url), None),
        None => {
            eprintln!("starting the CrewCode server...");
            let server = server::spawn().map_err(io::Error::other)?;
            (
                client.with_server(&server.url, &server.password),
                Some(server),
            )
        }
    };
    let options = TerminalOptions::default()
        .mouse(true)
        .keyboard_enhancement(true);
    let app = CrewCode::new(client, Store::load()).with_start(start);
    let result = Program::new(app).terminal_options(options).run();
    drop(spawned);
    result.map(|_| ExitCode::SUCCESS)
}
