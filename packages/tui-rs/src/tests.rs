//! Screen-level tests: the whole interface driven without a terminal.

use crewtui::testing::Harness;
use crewtui::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{Value, json};

use crate::app::{CrewCode, Dispatch, Msg};
use crate::client::{Client, GlobalEvent};
use crate::store::Store;

fn harness(width: u16, height: u16) -> Harness<CrewCode> {
    let app = CrewCode::new(Client::new("http://127.0.0.1:1", "/work"), Store::default());
    Harness::new(app, width, height)
}

fn plain_message() -> Dispatch {
    Dispatch::Message {
        instructions: Vec::new(),
        files: Vec::new(),
    }
}

fn key(code: KeyCode) -> KeyEvent {
    KeyEvent::new(code, KeyModifiers::NONE)
}

fn typed(harness: &mut Harness<CrewCode>, text: &str) {
    text.chars().for_each(|c| {
        harness.key(key(KeyCode::Char(c)));
    });
}

fn ctrl(harness: &mut Harness<CrewCode>, c: char) {
    harness.key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::CTRL));
}

fn server(harness: &mut Harness<CrewCode>, kind: &str, properties: Value) {
    let event: GlobalEvent =
        serde_json::from_value(json!({"payload": {"type": kind, "properties": properties}}))
            .unwrap();
    harness.message(Msg::Server(event));
}

/// A harness whose current session already exists, as after the first prompt.
fn in_session(width: u16, height: u16) -> Harness<CrewCode> {
    let mut harness = harness(width, height);
    harness.app_mut().session = Some("ses_1".to_owned());
    harness
}

#[test]
fn the_home_screen_shows_the_welcome_and_an_empty_prompt() {
    let harness = harness(100, 30);
    let screen = harness.screen();
    assert!(screen.contains("your terminal coding agent"));
    assert!(screen.contains("Ask CrewCode anything"));
    assert!(screen.contains("/ skills") && screen.contains("ctrl+p palette"));
}

#[test]
fn the_palette_opens_filters_and_closes() {
    let mut harness = harness(100, 30);
    ctrl(&mut harness, 'p');
    assert!(harness.screen().contains("New session"));
    typed(&mut harness, "theme");
    let screen = harness.screen();
    assert!(screen.contains("Change theme") && !screen.contains("New session"));
    harness.key(key(KeyCode::Esc));
    assert!(!harness.screen().contains("Change theme"));
}

fn with_commands(harness: &mut Harness<CrewCode>) {
    use crate::client::CommandChoice;
    let command = |name: &str, source: &str| CommandChoice {
        name: name.to_owned(),
        description: format!("does {name}"),
        source: source.to_owned(),
        template: format!("instructions of {name}: $ARGUMENTS"),
    };
    harness.app_mut().commands = vec![
        command("init", "command"),
        command("review", "skill"),
        command("release", "skill"),
    ];
}

#[test]
fn a_leading_slash_is_typed_into_the_prompt_and_suggests_skills() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/");
    let screen = harness.screen();
    assert!(screen.contains("/init") && screen.contains("/review") && screen.contains("skill"));
    assert!(!screen.contains("New session"), "the palette must not open");
    assert!(
        screen.rows().iter().any(|row| row.contains("❯ /")),
        "the slash must stay in the prompt:\n{}",
        screen.text()
    );
}

#[test]
fn typing_after_the_slash_narrows_the_suggestions() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/rev");
    let screen = harness.screen();
    assert!(
        screen.contains("/review") && !screen.contains("/init") && !screen.contains("/release")
    );
}

#[test]
fn tab_completes_the_highlighted_command_with_a_trailing_space() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/re");
    harness.key(key(KeyCode::Down));
    harness.key(key(KeyCode::Tab));
    assert_eq!(harness.app().prompt_text(), "/release ");
    assert!(
        harness.app().suggestions().is_empty(),
        "arguments follow, so no more suggestions"
    );
}

#[test]
fn enter_completes_a_partial_command_but_sends_a_complete_one() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/rev");
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.app().prompt_text(), "/review ");
    assert!(!harness.app().busy, "completing must not send");
    let mut harness = crate::tests::harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/init");
    harness.key(key(KeyCode::Enter));
    assert!(harness.app().busy, "a complete command is sent");
}

#[test]
fn a_command_with_arguments_is_sent_as_a_command_even_as_the_first_message() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/review the parser");
    harness.key(key(KeyCode::Enter));
    assert!(harness.app().busy);
    assert_eq!(
        harness.app().dispatch_for_test("/review the parser"),
        Dispatch::Command {
            name: "review".to_owned(),
            arguments: "the parser".to_owned()
        }
    );
}

#[test]
fn escape_dismisses_the_suggestions_and_unknown_commands_send_as_text() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/re");
    harness.key(key(KeyCode::Esc));
    assert!(harness.app().suggestions().is_empty());
    assert_eq!(harness.app().prompt_text(), "/re");
    assert_eq!(
        harness.app().dispatch_for_test("/zzz something"),
        plain_message()
    );
    assert_eq!(harness.app().dispatch_for_test("/re"), plain_message());
}

#[test]
fn the_palette_still_opens_with_ctrl_p_and_lists_the_server_commands() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    ctrl(&mut harness, 'p');
    assert!(harness.screen().contains("New session"));
    typed(&mut harness, "review");
    assert!(harness.screen().contains("/review"));
}

#[test]
fn choosing_a_theme_from_the_palette_changes_it() {
    let mut harness = harness(100, 30);
    ctrl(&mut harness, 't');
    typed(&mut harness, "tokyo");
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.app().theme.name, "tokyonight");
}

#[test]
fn a_streamed_answer_appears_with_the_sidebar_on_a_wide_screen() {
    let mut harness = in_session(120, 30);
    server(
        &mut harness,
        "message.updated",
        json!({"sessionID": "ses_1", "info": {"id": "m1", "role": "assistant"}}),
    );
    server(
        &mut harness,
        "message.part.updated",
        json!({"sessionID": "ses_1", "part": {"id": "p1", "messageID": "m1", "type": "text", "text": "Hel"}}),
    );
    server(
        &mut harness,
        "message.part.delta",
        json!({"sessionID": "ses_1", "messageID": "m1", "partID": "p1", "field": "text", "delta": "lo there"}),
    );
    let screen = harness.screen();
    assert!(screen.contains("Hello there"));
    assert!(
        screen.contains("approval"),
        "the sidebar is missing:\n{}",
        screen.text()
    );
}

#[test]
fn a_narrow_screen_hides_the_sidebar() {
    let mut harness = in_session(80, 30);
    server(
        &mut harness,
        "message.part.updated",
        json!({"sessionID": "ses_1", "part": {"id": "p1", "messageID": "m1", "type": "text", "text": "hi"}}),
    );
    assert!(!harness.screen().contains("approval"));
}

#[test]
fn events_for_other_sessions_are_ignored() {
    let mut harness = in_session(100, 30);
    server(
        &mut harness,
        "message.part.updated",
        json!({"sessionID": "ses_other", "part": {"id": "p1", "messageID": "m1", "type": "text", "text": "intruder"}}),
    );
    assert!(!harness.screen().contains("intruder"));
}

#[test]
fn a_permission_request_shows_its_diff_and_a_key_answers_it() {
    let mut harness = in_session(100, 34);
    server(
        &mut harness,
        "permission.asked",
        json!({"id": "per_1", "sessionID": "ses_1", "permission": "edit", "patterns": [],
               "metadata": {"filepath": "src/main.rs", "diff": "@@ -1 +1 @@\n-old\n+new"}}),
    );
    let screen = harness.screen();
    assert!(
        screen.contains("permission needed")
            && screen.contains("src/main.rs")
            && screen.contains("+new")
    );
    typed(&mut harness, "y");
    assert!(!harness.screen().contains("permission needed"));
    assert_eq!(harness.pending_jobs(), 1);
}

#[test]
fn a_question_is_answered_with_the_chosen_option() {
    let mut harness = in_session(100, 34);
    server(
        &mut harness,
        "question.asked",
        json!({"id": "que_1", "sessionID": "ses_1", "questions": [
            {"header": "Cake", "question": "Which cake?", "options": [
                {"label": "Chocolate", "description": ""}, {"label": "Strawberry", "description": ""}]}]}),
    );
    assert!(harness.screen().contains("Which cake?"));
    harness.key(key(KeyCode::Down));
    harness.key(key(KeyCode::Enter));
    assert!(!harness.screen().contains("Which cake?"));
    assert_eq!(harness.pending_jobs(), 1);
}

#[test]
fn enter_sends_a_prompt_and_marks_the_app_busy() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "hello");
    harness.key(key(KeyCode::Enter));
    assert!(harness.app().busy);
    assert!(harness.screen().contains("working"));
    assert!(harness.pending_jobs() >= 1);
}

#[test]
fn alt_enter_adds_a_line_and_grows_the_field() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "one");
    harness.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::ALT));
    typed(&mut harness, "two");
    let screen = harness.screen();
    assert!(screen.contains("one") && screen.contains("two"));
    assert!(!harness.app().busy, "alt+enter must not send");
}

#[test]
fn a_failed_request_is_shown_as_a_toast() {
    let mut harness = harness(100, 30);
    harness.message(Msg::Done("rename", Err("boom".to_owned())));
    assert!(harness.screen().contains("rename failed: boom"));
}

#[test]
fn a_finished_session_stops_the_working_indicator() {
    let mut harness = in_session(100, 30);
    harness.app_mut().busy = true;
    server(&mut harness, "session.idle", json!({"sessionID": "ses_1"}));
    assert!(!harness.app().busy);
}

#[test]
fn copying_the_last_answer_uses_the_clipboard() {
    let mut harness = in_session(100, 30);
    server(
        &mut harness,
        "message.updated",
        json!({"sessionID": "ses_1", "info": {"id": "m1", "role": "assistant"}}),
    );
    server(
        &mut harness,
        "message.part.updated",
        json!({"sessionID": "ses_1", "part": {"id": "p1", "messageID": "m1", "type": "text", "text": "the answer"}}),
    );
    ctrl(&mut harness, 'p');
    typed(&mut harness, "copy");
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.take_clipboard(), ["the answer"]);
    assert!(harness.screen().contains("copied to clipboard"));
}

#[test]
fn enter_while_busy_keeps_the_message_by_sending_it() {
    let mut harness = harness(100, 30);
    harness.app_mut().busy = true;
    typed(&mut harness, "one more thing");
    harness.key(key(KeyCode::Enter));
    assert!(
        harness.app().prompt_text().is_empty(),
        "the text left the field because it was sent"
    );
    assert!(harness.pending_jobs() >= 1);
}

#[test]
fn escape_needs_two_presses_to_interrupt_a_run() {
    let mut harness = in_session(100, 30);
    harness.app_mut().busy = true;
    harness.key(key(KeyCode::Esc));
    assert!(harness.screen().contains("esc again to stop"));
    assert_eq!(harness.pending_jobs(), 0, "one press must not interrupt");
    harness.key(key(KeyCode::Esc));
    assert_eq!(harness.pending_jobs(), 1);
}

#[test]
fn ctrl_c_while_busy_asks_before_quitting_and_the_window_closes() {
    let mut harness = harness(100, 30);
    harness.app_mut().busy = true;
    ctrl(&mut harness, 'c');
    assert!(!harness.has_quit());
    assert!(harness.screen().contains("ctrl+c again to quit"));
    harness.fire_timers();
    assert!(!harness.screen().contains("ctrl+c again to quit"));
    ctrl(&mut harness, 'c');
    ctrl(&mut harness, 'c');
    assert!(harness.has_quit());
}

#[test]
fn the_footer_drops_whole_hints_instead_of_cutting_one() {
    let mut harness = harness(50, 20);
    harness.app_mut().busy = true;
    let footer = harness.screen().rows().last().cloned().unwrap_or_default();
    assert!(footer.contains("working"), "{footer}");
    assert!(
        !footer.contains("ag ") && !footer.ends_with("pgup"),
        "{footer}"
    );
}

#[test]
fn a_placeholder_session_title_reads_as_untitled() {
    use crate::app::display_title;
    assert_eq!(
        display_title("New session - 2026-09-30T13:29:36.299Z"),
        "untitled"
    );
    assert_eq!(display_title(""), "untitled");
    assert_eq!(display_title("Fix the parser"), "Fix the parser");
}

#[test]
fn ctrl_c_clears_a_typed_message_and_quits_when_it_is_empty() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "draft");
    ctrl(&mut harness, 'c');
    assert!(!harness.has_quit());
    ctrl(&mut harness, 'c');
    assert!(harness.has_quit());
}

#[test]
fn recent_models_come_first_in_the_model_picker() {
    use crate::client::ModelChoice;
    let mut harness = harness(100, 30);
    let model = |provider: &str, name: &str| ModelChoice {
        provider_id: provider.to_owned(),
        provider_name: provider.to_owned(),
        model_id: name.to_owned(),
        name: name.to_owned(),
        context_limit: 0,
        variants: Vec::new(),
    };
    harness.app_mut().models = vec![model("a", "alpha"), model("b", "beta"), model("c", "gamma")];
    harness.app_mut().store.remember_model("c/gamma");
    ctrl(&mut harness, 's');
    let rows = harness.screen().rows();
    let position = |needle: &str| rows.iter().position(|row| row.contains(needle)).unwrap();
    assert!(
        position("gamma") < position("alpha"),
        "{}",
        harness.screen().text()
    );
    assert!(harness.screen().contains("recent"));
}

#[test]
fn a_long_model_list_says_how_many_more_are_below() {
    use crate::client::ModelChoice;
    let mut harness = harness(100, 30);
    harness.app_mut().models = (0..40)
        .map(|n| ModelChoice {
            provider_id: "p".to_owned(),
            provider_name: "Provider".to_owned(),
            model_id: format!("m{n:02}"),
            name: format!("Model {n:02}"),
            context_limit: 0,
            variants: Vec::new(),
        })
        .collect();
    ctrl(&mut harness, 's');
    assert!(
        harness.screen().contains("↓ 26 more"),
        "{}",
        harness.screen().text()
    );
}

#[test]
fn the_sidebar_shows_context_usage_against_the_model_limit() {
    use crate::client::ModelChoice;
    let mut harness = in_session(120, 30);
    harness.app_mut().models = vec![ModelChoice {
        provider_id: "p".to_owned(),
        provider_name: "P".to_owned(),
        model_id: "m".to_owned(),
        name: "M".to_owned(),
        context_limit: 1000,
        variants: Vec::new(),
    }];
    server(
        &mut harness,
        "message.updated",
        json!({"sessionID": "ses_1", "info": {"id": "m1", "role": "assistant",
        "providerID": "p", "modelID": "m", "tokens": {"input": 250, "output": 0, "cache": {"read": 0}}}}),
    );
    server(
        &mut harness,
        "message.part.updated",
        json!({"sessionID": "ses_1", "part": {"id": "p1", "messageID": "m1", "type": "text", "text": "hi"}}),
    );
    let screen = harness.screen();
    assert!(screen.contains(" 25%"), "{}", screen.text());
    assert!(screen.contains("█"));
}

#[test]
fn without_a_sidebar_the_footer_shows_the_context_percentage() {
    use crate::client::ModelChoice;
    let mut harness = in_session(90, 30);
    harness.app_mut().models = vec![ModelChoice {
        provider_id: "p".to_owned(),
        provider_name: "P".to_owned(),
        model_id: "m".to_owned(),
        name: "M".to_owned(),
        context_limit: 1000,
        variants: Vec::new(),
    }];
    server(
        &mut harness,
        "message.updated",
        json!({"sessionID": "ses_1", "info": {"id": "m1", "role": "assistant",
        "providerID": "p", "modelID": "m", "tokens": {"input": 500, "output": 0, "cache": {"read": 0}}}}),
    );
    assert!(
        harness.screen().contains("ctx 50%"),
        "{}",
        harness.screen().text()
    );
}

#[test]
fn tab_cycles_through_the_agents_and_wraps_around() {
    use crate::client::AgentChoice;
    let mut harness = harness(100, 30);
    harness.app_mut().agents = ["build", "plan"]
        .iter()
        .map(|name| AgentChoice {
            name: (*name).to_owned(),
            description: String::new(),
        })
        .collect();
    harness.key(key(KeyCode::Tab));
    assert_eq!(harness.app().choice.agent.as_deref(), Some("build"));
    assert!(harness.screen().contains("agent: build"));
    harness.key(key(KeyCode::Tab));
    harness.key(key(KeyCode::Tab));
    assert_eq!(harness.app().choice.agent.as_deref(), Some("build"));
}

#[test]
fn several_skills_in_one_prompt_travel_as_hidden_instructions() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    let Dispatch::Message { instructions, .. } = harness
        .app()
        .dispatch_for_test("/review /init check the parser")
    else {
        panic!("expected skills");
    };
    assert_eq!(instructions.len(), 2);
    assert!(
        instructions[0].contains("/review")
            && instructions[0].contains("instructions of review: check the parser")
    );
    assert!(instructions[1].contains("/init"));
}

#[test]
fn a_skill_in_the_middle_of_a_sentence_is_still_invoked_once() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    let Dispatch::Message { instructions, .. } = harness
        .app()
        .dispatch_for_test("please /review this and /review that")
    else {
        panic!("expected skills");
    };
    assert_eq!(instructions.len(), 1);
    assert!(instructions[0].contains("please this and that"));
}

#[test]
fn paths_and_unknown_words_with_a_slash_are_plain_text() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    assert_eq!(
        harness
            .app()
            .dispatch_for_test("look at /tmp/x and /usr/bin"),
        plain_message()
    );
}

#[test]
fn a_second_skill_gets_its_own_suggestions_and_completion() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "/review /re");
    let screen = harness.screen();
    assert!(screen.contains("/release"), "{}", screen.text());
    harness.key(key(KeyCode::Tab));
    assert_eq!(harness.app().prompt_text(), "/review /review ");
}

#[test]
fn enter_completes_the_second_word_instead_of_sending() {
    let mut harness = harness(100, 30);
    with_commands(&mut harness);
    typed(&mut harness, "fix it with /rel");
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.app().prompt_text(), "fix it with /release ");
    assert!(!harness.app().busy);
}

fn with_a_project_file() -> (Harness<CrewCode>, std::path::PathBuf) {
    let directory = std::env::temp_dir().join(format!("crewcode-tui-test-{}", std::process::id()));
    std::fs::create_dir_all(directory.join("src")).unwrap();
    std::fs::write(directory.join("src/lib.rs"), "fn main() {}").unwrap();
    let app = CrewCode::new(
        Client::new("http://127.0.0.1:1", directory.to_str().unwrap()),
        Store::default(),
    );
    (Harness::new(app, 100, 30), directory)
}

#[test]
fn a_mentioned_file_that_exists_is_attached_and_one_that_does_not_is_text() {
    let (harness, directory) = with_a_project_file();
    let Dispatch::Message { files, .. } = harness
        .app()
        .dispatch_for_test("explain @src/lib.rs and @nope.rs and @src/lib.rs")
    else {
        panic!("expected a message");
    };
    assert_eq!(files, ["src/lib.rs"]);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn a_command_with_a_file_is_sent_as_a_message_so_the_file_travels_with_it() {
    let (mut harness, directory) = with_a_project_file();
    with_commands(&mut harness);
    let Dispatch::Message {
        instructions,
        files,
    } = harness.app().dispatch_for_test("/review @src/lib.rs")
    else {
        panic!("expected a message");
    };
    assert_eq!((instructions.len(), files.len()), (1, 1));
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn typing_an_at_word_looks_files_up_and_lists_them() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "look at @ma");
    assert_eq!(harness.pending_jobs(), 2, "one search per key after the @");
    harness.message(Msg::FilesFound(
        "ma".to_owned(),
        Ok(vec!["src/main.rs".to_owned(), "docs/map.md".to_owned()]),
    ));
    let screen = harness.screen();
    assert!(
        screen.contains("@src/main.rs") && screen.contains("@docs/map.md"),
        "{}",
        screen.text()
    );
    harness.key(key(KeyCode::Tab));
    assert_eq!(harness.app().prompt_text(), "look at @src/main.rs ");
}

#[test]
fn file_results_for_an_old_query_are_dropped() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "@mai");
    harness.message(Msg::FilesFound(
        "ma".to_owned(),
        Ok(vec!["stale.rs".to_owned()]),
    ));
    assert!(!harness.screen().contains("stale.rs"));
}

#[test]
fn the_status_row_names_the_agent_and_model_before_anything_is_sent() {
    use crate::client::{AgentChoice, ModelChoice};
    let mut harness = harness(100, 30);
    harness.app_mut().models = vec![ModelChoice {
        provider_id: "or".to_owned(),
        provider_name: "OpenRouter".to_owned(),
        model_id: "haiku".to_owned(),
        name: "Claude Haiku".to_owned(),
        context_limit: 0,
        variants: Vec::new(),
    }];
    harness.app_mut().agents = vec![AgentChoice {
        name: "build".to_owned(),
        description: String::new(),
    }];
    harness.app_mut().choice.model = crate::client::ModelSelection::parse("or/haiku");
    harness.app_mut().choice.agent = Some("build".to_owned());
    let row = harness.screen().rows().last().cloned().unwrap();
    assert!(row.contains("build · Claude Haiku · OpenRouter"), "{row}");
}

#[test]
fn while_busy_the_status_row_shows_the_running_tool_and_keeps_the_stop_hint() {
    let mut harness = in_session(100, 30);
    harness.app_mut().busy = true;
    server(
        &mut harness,
        "message.part.updated",
        json!({"sessionID": "ses_1", "part": {"id": "p1", "messageID": "m1", "type": "tool",
        "tool": "write", "state": {"status": "running", "input": {"filePath": "notes.md"}}}}),
    );
    let row = harness.screen().rows().last().cloned().unwrap();
    assert!(
        row.contains("write notes.md") && row.contains("esc esc stop"),
        "{row}"
    );
}

#[test]
fn the_theme_picker_previews_and_escape_restores() {
    let mut harness = harness(100, 30);
    ctrl(&mut harness, 't');
    harness.key(key(KeyCode::Down));
    assert_ne!(
        harness.app().theme.name,
        "terminal",
        "moving the cursor previews"
    );
    harness.key(key(KeyCode::Esc));
    assert_eq!(
        harness.app().theme.name,
        "terminal",
        "escape puts the old theme back"
    );
}

#[test]
fn pickers_open_on_the_current_entry_and_mark_it() {
    let mut harness = harness(100, 30);
    harness.app_mut().theme = crate::themes::find("nord", crate::themes::Mode::Dark).unwrap();
    ctrl(&mut harness, 't');
    let screen = harness.screen();
    let row = screen
        .rows()
        .into_iter()
        .find(|r| r.contains("nord"))
        .unwrap();
    assert!(row.contains('●') && row.contains('▸'), "{row}");
}

#[test]
fn the_model_the_server_picked_is_kept_and_shown_when_nothing_was_chosen() {
    let mut harness = in_session(100, 30);
    assert!(harness.app().choice.model.is_none());
    server(
        &mut harness,
        "message.updated",
        json!({"sessionID": "ses_1", "info": {"id": "m1", "role": "assistant",
        "providerID": "p", "modelID": "picked"}}),
    );
    assert_eq!(
        harness
            .app()
            .choice
            .model
            .as_ref()
            .map(|m| m.qualified())
            .as_deref(),
        Some("p/picked")
    );
    assert!(harness.screen().rows().last().unwrap().contains("p/picked"));
}

fn providers() -> crate::app::ConnectData {
    use crate::client::ProviderInfo;
    let provider = |id: &str, name: &str| ProviderInfo {
        id: id.to_owned(),
        name: name.to_owned(),
        connected: false,
    };
    (
        vec![
            provider("openrouter", "OpenRouter"),
            provider("alpha", "Alpha"),
        ],
        std::collections::HashMap::new(),
    )
}

fn connect_dialog(harness: &mut Harness<CrewCode>) {
    ctrl(harness, 'k');
    assert_eq!(harness.pending_jobs(), 1, "the providers are loaded first");
    harness.message(Msg::ConnectLoaded(Ok(providers())));
}

#[test]
fn ctrl_k_opens_the_provider_list_after_loading_it() {
    let mut harness = harness(100, 30);
    connect_dialog(&mut harness);
    let screen = harness.screen();
    assert!(
        screen.contains("connect a provider")
            && screen.contains("OpenRouter")
            && screen.contains("Other provider"),
        "{}",
        screen.text()
    );
}

#[test]
fn an_api_key_is_never_drawn_and_is_saved_on_enter() {
    let mut harness = harness(100, 30);
    connect_dialog(&mut harness);
    harness.key(key(KeyCode::Enter));
    assert!(harness.screen().contains("OpenRouter · API key"));
    typed(&mut harness, "sk-secret-123");
    let screen = harness.screen();
    assert!(
        !screen.contains("sk-secret"),
        "the key must not appear:\n{}",
        screen.text()
    );
    assert!(screen.contains("•••••••••••••"));
    harness.key(key(KeyCode::Enter));
    assert!(harness.screen().contains("Saving the key"));
    assert_eq!(
        harness.pending_jobs(),
        2,
        "the provider load that opened the dialog, and the save"
    );
}

#[test]
fn a_pasted_key_goes_into_the_dialog_not_the_prompt() {
    let mut harness = harness(100, 30);
    connect_dialog(&mut harness);
    harness.key(key(KeyCode::Enter));
    harness.message(Msg::Paste("sk-pasted\n".to_owned()));
    assert!(harness.app().prompt_text().is_empty());
    assert!(!harness.screen().contains("sk-pasted"));
    assert!(harness.screen().contains("•••••••••"));
}

#[test]
fn after_connecting_the_new_providers_models_are_offered() {
    use crate::client::ModelChoice;
    use crate::connect::Provider;
    let mut harness = harness(100, 30);
    harness.message(Msg::ConnectSaved(
        Provider {
            id: "alpha".to_owned(),
            name: "Alpha".to_owned(),
        },
        Ok(()),
    ));
    assert!(harness.screen().contains("connected Alpha"));
    let model = |provider: &str, name: &str| ModelChoice {
        provider_id: provider.to_owned(),
        provider_name: provider.to_owned(),
        model_id: name.to_owned(),
        name: name.to_owned(),
        context_limit: 0,
        variants: Vec::new(),
    };
    harness.message(Msg::ConnectedModels(
        "alpha".to_owned(),
        Ok((
            vec![model("alpha", "Alpha One"), model("beta", "Beta One")],
            None,
        )),
    ));
    let screen = harness.screen();
    assert!(
        screen.contains("Alpha One") && !screen.contains("Beta One"),
        "only the new provider's models:\n{}",
        screen.text()
    );
}

#[test]
fn a_failed_key_save_closes_the_dialog_and_says_why() {
    use crate::connect::Provider;
    let mut harness = harness(100, 30);
    connect_dialog(&mut harness);
    harness.message(Msg::ConnectSaved(
        Provider {
            id: "alpha".to_owned(),
            name: "Alpha".to_owned(),
        },
        Err("invalid key".to_owned()),
    ));
    let screen = harness.screen();
    assert!(
        !screen.contains("connect a provider") && screen.contains("could not connect: invalid key")
    );
}

#[test]
fn a_first_run_with_no_models_opens_the_connect_dialog_once() {
    let mut harness = harness(100, 30);
    harness.message(Msg::ModelsLoaded(Ok((Vec::new(), None))));
    assert_eq!(harness.pending_jobs(), 1);
    assert!(harness.screen().contains("no provider connected yet"));
    harness.run_commands();
    harness.message(Msg::ModelsLoaded(Ok((Vec::new(), None))));
    assert_eq!(
        harness.pending_jobs(),
        0,
        "the dialog is offered once, not on every reload"
    );
}

#[test]
fn a_failed_sign_in_start_is_reported() {
    use crate::connect::Provider;
    let mut harness = harness(100, 30);
    connect_dialog(&mut harness);
    harness.message(Msg::Authorized(
        Provider {
            id: "alpha".to_owned(),
            name: "Alpha".to_owned(),
        },
        0,
        Err("no route".to_owned()),
    ));
    assert!(harness.screen().contains("sign in failed: no route"));
}

#[test]
fn the_theme_mode_switches_variants_and_light_themes_paint_the_screen() {
    let mut harness = harness(100, 30);
    harness.app_mut().theme = crate::themes::find("tokyonight", crate::themes::Mode::Dark).unwrap();
    ctrl(&mut harness, 'p');
    typed(&mut harness, "theme mode");
    harness.key(key(KeyCode::Enter));
    let app = harness.app();
    assert_eq!(app.theme_mode, crate::themes::Mode::Light);
    assert_eq!(
        app.theme.name, "tokyonight",
        "the same theme, its light variant"
    );
    assert!(app.theme.paints);
    let background = app.theme.background;
    assert_eq!(
        harness.screen().cell(0, 5).style().bg,
        Some(background),
        "the whole screen is painted"
    );
}

#[test]
fn a_dark_theme_leaves_the_terminal_background_alone() {
    let mut harness = harness(100, 30);
    harness.app_mut().theme = crate::themes::find("nord", crate::themes::Mode::Dark).unwrap();
    assert_eq!(harness.screen().cell(0, 5).style().bg, None);
}

fn with_mcp_and_skills(harness: &mut Harness<CrewCode>) {
    use crate::client::CommandChoice;
    with_commands(harness);
    harness.app_mut().mcp = vec![
        ("files".to_owned(), "connected".to_owned()),
        ("search".to_owned(), "needs_auth".to_owned()),
    ];
    let skill = CommandChoice {
        name: "deploy".to_owned(),
        description: "Ship it. Carefully.".to_owned(),
        source: "skill".to_owned(),
        template: String::new(),
    };
    harness.app_mut().commands.push(skill);
}

fn palette_entry(harness: &mut Harness<CrewCode>, query: &str) {
    ctrl(harness, 'p');
    typed(harness, query);
    harness.key(key(KeyCode::Enter));
}

#[test]
fn the_skills_dialog_lists_only_skills_and_inserts_the_chosen_one() {
    let mut harness = harness(100, 30);
    with_mcp_and_skills(&mut harness);
    palette_entry(&mut harness, "skills");
    let screen = harness.screen();
    assert!(
        screen.contains("/deploy") && screen.contains("Ship it") && !screen.contains("/init"),
        "{}",
        screen.text()
    );
    typed(&mut harness, "deploy");
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.app().prompt_text(), "/deploy ");
}

#[test]
fn the_mcp_dialog_shows_each_server_and_toggling_sends_a_request() {
    let mut harness = harness(100, 30);
    with_mcp_and_skills(&mut harness);
    palette_entry(&mut harness, "mcp");
    let screen = harness.screen();
    assert!(
        screen.contains("files") && screen.contains("needs auth"),
        "{}",
        screen.text()
    );
    harness.key(key(KeyCode::Down));
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.pending_jobs(), 1);
    harness.message(Msg::McpToggled(
        "search".to_owned(),
        Ok(vec![
            ("files".to_owned(), "connected".to_owned()),
            ("search".to_owned(), "connected".to_owned()),
        ]),
    ));
    assert!(
        !harness.screen().contains("needs auth"),
        "the list is refreshed and stays open"
    );
    assert!(harness.screen().contains("MCP servers"));
}

#[test]
fn the_thinking_level_offers_what_the_model_has_and_is_sent_with_the_choice() {
    use crate::client::ModelChoice;
    let mut harness = harness(100, 30);
    harness.app_mut().models = vec![ModelChoice {
        provider_id: "p".to_owned(),
        provider_name: "P".to_owned(),
        model_id: "m".to_owned(),
        name: "M".to_owned(),
        context_limit: 0,
        variants: vec!["low".to_owned(), "high".to_owned()],
    }];
    harness.app_mut().choice.model = crate::client::ModelSelection::parse("p/m");
    palette_entry(&mut harness, "thinking");
    assert!(harness.screen().contains("high"));
    typed(&mut harness, "high");
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.app().choice.variant.as_deref(), Some("high"));
    assert!(harness.screen().rows().last().unwrap().contains("· high"));
}

#[test]
fn a_model_without_thinking_levels_says_so() {
    let mut harness = harness(100, 30);
    palette_entry(&mut harness, "thinking");
    assert!(harness.screen().contains("no thinking levels"));
}

#[test]
fn stashing_sets_the_message_aside_and_restoring_brings_it_back() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "half a thought");
    palette_entry(&mut harness, "stash message");
    assert!(harness.app().prompt_text().is_empty());
    assert_eq!(harness.app().store.stash, ["half a thought"]);
    typed(&mut harness, "something else");
    palette_entry(&mut harness, "restore");
    assert!(harness.screen().contains("half a thought"));
    harness.key(key(KeyCode::Enter));
    assert_eq!(harness.app().prompt_text(), "half a thought");
    assert_eq!(
        harness.app().store.stash,
        ["something else"],
        "what was being typed took its place"
    );
}

#[test]
fn an_empty_stash_and_an_empty_message_say_so() {
    let mut harness = harness(100, 30);
    palette_entry(&mut harness, "stash message");
    assert!(harness.screen().contains("nothing to stash"));
    let mut harness = crate::tests::harness(100, 30);
    palette_entry(&mut harness, "restore");
    assert!(harness.screen().contains("the stash is empty"));
}

#[test]
fn subagent_sessions_open_with_a_way_back_to_the_parent() {
    use crate::client::Session;
    let mut harness = in_session(100, 30);
    harness.app_mut().session_title = "Main work".to_owned();
    palette_entry(&mut harness, "subagent");
    assert_eq!(harness.pending_jobs(), 1);
    let child: Session = serde_json::from_value(
        json!({"id": "ses_child", "title": "Explore the parser", "parentID": "ses_1"}),
    )
    .unwrap();
    harness.message(Msg::ChildrenLoaded(Ok(vec![child])));
    assert!(harness.screen().contains("Explore the parser"));
    harness.key(key(KeyCode::Enter));
    harness.message(Msg::Loaded {
        id: "ses_child".to_owned(),
        title: "Explore the parser".to_owned(),
        parent: Some(("ses_1".to_owned(), "Main work".to_owned())),
        messages: Ok(Vec::new()),
    });
    let screen = harness.screen();
    assert!(screen.contains("↳ Explore the parser"), "{}", screen.text());
    ctrl(&mut harness, 'p');
    assert!(
        harness.screen().contains("Back to the parent session")
            && harness.screen().contains("Main work")
    );
}

#[test]
fn alt_m_cycles_the_approval_mode_and_the_status_row_shows_a_mode_that_is_not_manual() {
    let mut harness = harness(100, 30);
    harness.key(KeyEvent::new(KeyCode::Char('m'), KeyModifiers::ALT));
    assert_eq!(harness.pending_jobs(), 1, "the change goes to the server");
    harness.message(Msg::ModeChanged(Ok("auto".to_owned())));
    assert!(harness.screen().contains("approval mode: auto"));
    harness.app_mut().choice.model = crate::client::ModelSelection::parse("p/m");
    assert!(
        harness.screen().rows().last().unwrap().contains("· auto"),
        "{}",
        harness.screen().text()
    );
}

#[test]
fn the_unguarded_mode_cannot_be_left_from_the_interface() {
    let mut harness = harness(100, 30);
    harness.app_mut().permission_mode = "unguarded".to_owned();
    harness.key(KeyEvent::new(KeyCode::Char('m'), KeyModifiers::ALT));
    assert_eq!(harness.pending_jobs(), 0);
    assert!(
        harness
            .screen()
            .contains("unguarded mode cannot be changed")
    );
}

#[test]
fn slash_approval_is_a_local_command_that_cycles_instead_of_sending() {
    let mut harness = harness(100, 30);
    typed(&mut harness, "/appr");
    assert!(
        harness.screen().contains("/approval"),
        "{}",
        harness.screen().text()
    );
    typed(&mut harness, "oval");
    harness.key(key(KeyCode::Enter));
    assert!(!harness.app().busy, "it must not be sent as a message");
    assert_eq!(
        harness.pending_jobs(),
        1,
        "it asks the server to change the mode"
    );
}

#[test]
fn the_command_line_model_and_agent_are_used_for_the_first_messages() {
    use crate::cli::Start;
    let app = CrewCode::new(Client::new("http://127.0.0.1:1", "/work"), Store::default())
        .with_start(Start {
            model: Some("openai/gpt".to_owned()),
            agent: Some("plan".to_owned()),
            ..Start::default()
        });
    assert_eq!(
        app.choice.model.as_ref().map(|m| m.qualified()).as_deref(),
        Some("openai/gpt")
    );
    assert_eq!(app.choice.agent.as_deref(), Some("plan"));
}

#[test]
fn a_prompt_from_the_command_line_is_sent_once_the_session_is_ready() {
    use crate::cli::Start;
    let app = CrewCode::new(Client::new("http://127.0.0.1:1", "/work"), Store::default())
        .with_start(Start {
            prompt: Some("fix the parser".to_owned()),
            ..Start::default()
        });
    let mut harness = Harness::new(app, 100, 30);
    harness.message(Msg::StartResolved(Ok(None)));
    assert!(
        harness.app().busy,
        "with no session to open, the prompt goes out at once"
    );
    assert_eq!(harness.pending_jobs(), 1);
}

#[test]
fn a_session_from_the_command_line_is_opened_before_its_prompt_is_sent() {
    use crate::cli::Start;
    let app = CrewCode::new(Client::new("http://127.0.0.1:1", "/work"), Store::default())
        .with_start(Start {
            session: Some("ses_7".to_owned()),
            prompt: Some("go on".to_owned()),
            ..Start::default()
        });
    let mut harness = Harness::new(app, 100, 30);
    harness.message(Msg::StartResolved(Ok(Some((
        "ses_7".to_owned(),
        "Old work".to_owned(),
    )))));
    assert!(
        !harness.app().busy,
        "nothing is sent until the history is loaded"
    );
    harness.message(Msg::Loaded {
        id: "ses_7".to_owned(),
        title: "Old work".to_owned(),
        parent: None,
        messages: Ok(Vec::new()),
    });
    assert!(harness.app().busy);
    assert!(harness.screen().contains("Old work"));
}

#[test]
fn a_session_that_cannot_be_found_is_reported() {
    let mut harness = harness(100, 30);
    harness.message(Msg::StartResolved(Err("not found".to_owned())));
    assert!(
        harness
            .screen()
            .contains("cannot open the session: not found")
    );
}
