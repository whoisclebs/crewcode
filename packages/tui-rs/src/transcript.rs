//! The conversation as the server describes it, and how each piece looks.
//!
//! The server reports a message, then its parts, then text added to a part.
//! A part is one entry of the [`HistoryState`], so a delta re-renders only
//! the entry it belongs to.

use std::collections::HashMap;

use crewtui::text::{Line, Span, Text};
use crewtui::widgets::HistoryState;
use crewtui::{Color, Style};
use crewtui_rich::{Diff, Markdown};
use serde_json::Value;

use crate::theme::Theme;

const TOOL_OUTPUT_LINES: usize = 6;
const DIFF_LINES: usize = 40;
/// A user message longer than this, such as an expanded skill, is cut.
const USER_LINES_SHOWN: usize = 10;

enum Kind {
    /// The model and duration under a finished assistant message.
    Footer,
    Text,
    Reasoning,
    Tool,
}

struct Block {
    message_id: String,
    kind: Kind,
    /// Text for text and reasoning; unused for tools.
    text: String,
    /// A reasoning part the model has stopped adding to.
    finished: bool,
    /// The server's tool part, kept whole because its state changes shape.
    tool: Value,
}

/// The conversation on screen.
pub struct Transcript {
    pub history: HistoryState,
    /// The model of the latest assistant message, as `provider/model`.
    pub model: Option<String>,
    /// Tokens of the latest assistant message's context, and the cost so far.
    pub context_tokens: u64,
    pub cost: f64,
    theme: Theme,
    /// Paths under this directory are shown relative to it.
    directory: String,
    blocks: Vec<Block>,
    index: HashMap<String, usize>,
    user_messages: HashMap<String, bool>,
    costs: HashMap<String, f64>,
}

impl Transcript {
    pub fn new(theme: Theme, directory: &str) -> Self {
        Self {
            history: HistoryState::new(),
            model: None,
            context_tokens: 0,
            cost: 0.0,
            theme,
            directory: directory.to_owned(),
            blocks: Vec::new(),
            index: HashMap::new(),
            user_messages: HashMap::new(),
            costs: HashMap::new(),
        }
    }

    pub fn clear(&mut self) {
        *self = Self::new(self.theme, &self.directory.clone());
    }

    /// Draws everything again with `theme`.
    pub fn set_theme(&mut self, theme: Theme) {
        self.theme = theme;
        (0..self.blocks.len()).for_each(|i| self.refresh(i));
    }

    /// What the agent is doing now, such as `write notes.md`, when a tool is running.
    pub fn active_tool(&self) -> Option<String> {
        let running = self.blocks.iter().rev().find(|b| {
            matches!(b.kind, Kind::Tool)
                && matches!(
                    b.tool["state"]["status"].as_str(),
                    Some("pending" | "running")
                )
        })?;
        let name = running.tool["tool"].as_str()?;
        let state = &running.tool["state"];
        let target = [
            "title",
            "filePath",
            "path",
            "description",
            "command",
            "pattern",
            "url",
            "query",
        ]
        .iter()
        .find_map(|key| {
            state[key]
                .as_str()
                .or_else(|| state["input"][key].as_str())
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_default()
        .replace(&format!("{}/", self.directory), "");
        Some(format!("{name} {target}").trim().to_owned())
    }

    /// The text of the latest assistant answer, for copying.
    pub fn last_answer(&self) -> Option<&str> {
        self.blocks
            .iter()
            .rev()
            .find(|b| {
                matches!(b.kind, Kind::Text)
                    && self.user_messages.get(&b.message_id) != Some(&true)
                    && !b.text.is_empty()
            })
            .map(|b| b.text.as_str())
    }

    /// Records who wrote a message, which decides how its text is drawn, and closes it once finished.
    pub fn apply_message(&mut self, info: &Value) {
        self.register_message(info);
        if let Some(id) = info["id"].as_str() {
            self.add_footer(id, info);
        }
    }

    fn register_message(&mut self, info: &Value) {
        let (Some(id), Some(role)) = (info["id"].as_str(), info["role"].as_str()) else {
            return;
        };
        self.user_messages.insert(id.to_owned(), role == "user");
        if let (Some(provider), Some(model)) =
            (info["providerID"].as_str(), info["modelID"].as_str())
        {
            self.model = Some(format!("{provider}/{model}"));
        }
        if role == "assistant" {
            self.costs
                .insert(id.to_owned(), info["cost"].as_f64().unwrap_or_default());
            self.cost = self.costs.values().sum();
            let tokens = &info["tokens"];
            let total = ["input", "output", "reasoning"]
                .iter()
                .filter_map(|k| tokens[k].as_u64())
                .sum::<u64>()
                + tokens["cache"]["read"].as_u64().unwrap_or_default();
            if total > 0 {
                self.context_tokens = total;
            }
        }
        let changed: Vec<usize> = (0..self.blocks.len())
            .filter(|&i| self.blocks[i].message_id == id)
            .collect();
        changed.into_iter().for_each(|i| self.refresh(i));
    }

    /// Closes a finished assistant message with its model and how long it took.
    fn add_footer(&mut self, id: &str, info: &Value) {
        let (Some(created), Some(completed)) = (
            info["time"]["created"].as_u64(),
            info["time"]["completed"].as_u64(),
        ) else {
            return;
        };
        let footer_id = format!("footer-{id}");
        // A step that ends in tool calls is followed by more work, so the turn is not over.
        if self.index.contains_key(&footer_id)
            || info["role"] != "assistant"
            || info["finish"] == "tool-calls"
        {
            return;
        }
        let seconds = completed.saturating_sub(created) as f64 / 1000.0;
        let model = info["modelID"].as_str().unwrap_or("assistant");
        self.blocks.push(Block {
            message_id: id.to_owned(),
            kind: Kind::Footer,
            text: format!("{model} · {seconds:.1}s"),
            finished: true,
            tool: Value::Null,
        });
        self.index.insert(footer_id, self.blocks.len() - 1);
        self.refresh(self.blocks.len() - 1);
    }

    /// Adds or replaces a whole part.
    pub fn apply_part(&mut self, part: &Value) {
        let (Some(id), Some(message_id), Some(kind)) = (
            part["id"].as_str(),
            part["messageID"].as_str(),
            part["type"].as_str(),
        ) else {
            return;
        };
        let kind = match kind {
            "text"
                if part["synthetic"].as_bool() == Some(true)
                    || part["ignored"].as_bool() == Some(true) =>
            {
                return;
            }
            "text" => Kind::Text,
            "reasoning" => Kind::Reasoning,
            "tool" => Kind::Tool,
            _ => return,
        };
        let i = match self.index.get(id) {
            Some(&i) => i,
            None => {
                self.blocks.push(Block {
                    message_id: message_id.to_owned(),
                    kind,
                    text: String::new(),
                    finished: false,
                    tool: Value::Null,
                });
                self.index.insert(id.to_owned(), self.blocks.len() - 1);
                self.blocks.len() - 1
            }
        };
        let block = &mut self.blocks[i];
        match block.kind {
            Kind::Tool => block.tool = part.clone(),
            _ => {
                block.text = part["text"].as_str().unwrap_or_default().to_owned();
                block.finished = part["time"]["end"].is_number();
            }
        }
        self.refresh(i);
    }

    /// Adds streamed text to a part.
    pub fn apply_delta(&mut self, part_id: &str, field: &str, delta: &str) {
        let Some(&i) = self.index.get(part_id) else {
            return;
        };
        if field != "text" {
            return;
        }
        self.blocks[i].text.push_str(delta);
        self.refresh(i);
    }

    /// Loads a stored message, as opposed to one arriving live.
    pub fn apply_stored(&mut self, info: &Value, parts: &[Value]) {
        self.register_message(info);
        parts.iter().for_each(|part| self.apply_part(part));
        if let Some(id) = info["id"].as_str() {
            self.add_footer(id, info);
        }
    }

    fn refresh(&mut self, i: usize) {
        let text = self.render(i);
        if i < self.history.len() {
            if let Some(entry) = self.history.entry_mut(i) {
                *entry = text;
            }
        } else {
            self.history.push(text);
        }
    }

    fn render(&self, i: usize) -> Text<'static> {
        let block = &self.blocks[i];
        let theme = &self.theme;
        let mut text = match block.kind {
            Kind::Text if self.user_messages.get(&block.message_id) == Some(&true) => {
                user(&block.text, theme)
            }
            Kind::Text => {
                let mut text = Markdown::new(&block.text)
                    .styles(theme.markdown())
                    .code_styles(theme.code())
                    .to_text();
                fill_code_rows(&mut text, theme);
                text
            }
            Kind::Reasoning => reasoning(&block.text, block.finished, theme),
            Kind::Footer => Text::from(Line::from(Span::styled(
                format!("◇ {}", block.text),
                theme.dim(),
            ))),
            Kind::Tool => tool(&block.tool, &self.directory, theme),
        };
        text.lines.push(Line::default());
        text
    }
}

/// Extends the fill behind a code block from its text to the whole row.
fn fill_code_rows(text: &mut Text<'static>, theme: &Theme) {
    if theme.panel == Color::Default {
        return;
    }
    text.lines
        .iter_mut()
        .filter(|line| {
            line.spans
                .iter()
                .any(|span| span.style.bg == Some(theme.panel))
        })
        .for_each(|line| {
            line.style = line.style.bg(theme.panel);
            line.fill = true;
        });
}

/// A unified diff without its file header lines, which repeat the path the card already shows.
pub fn strip_diff_header(diff: &str) -> String {
    diff.lines()
        .filter(|line| {
            !(line.starts_with("Index: ")
                || (line.len() >= 3 && line.chars().all(|c| c == '='))
                || line.starts_with("--- ")
                || line.starts_with("+++ "))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn user(text: &str, theme: &Theme) -> Text<'static> {
    let filled = theme.panel != Color::Default;
    let fill = Style::new().bg(theme.panel);
    let row = |spans: Vec<Span<'static>>| {
        let line = Line::from(spans);
        if filled {
            line.style(fill).full_width()
        } else {
            line
        }
    };
    let mut lines = vec![];
    if filled {
        lines.push(row(vec![Span::styled("▎", Style::new().fg(theme.user))]));
    }
    let total = text.lines().count();
    let shown = if total > USER_LINES_SHOWN {
        USER_LINES_SHOWN - 2
    } else {
        total
    };
    lines.extend(text.lines().take(shown).map(|line| {
        let mut spans = vec![Span::styled("▎ ", Style::new().fg(theme.user))];
        spans.extend(line.split_inclusive(' ').map(|word| {
            let mention = word.starts_with('@') || word.starts_with('/');
            let style = if mention {
                Style::new().fg(theme.accent).bold()
            } else {
                theme.plain().bold()
            };
            Span::styled(word.to_owned(), style)
        }));
        row(spans)
    }));
    if total > shown {
        lines.push(row(vec![
            Span::styled("▎ ", Style::new().fg(theme.user)),
            Span::styled(format!("… {} more lines", total - shown), theme.dim()),
        ]));
    }
    if filled {
        lines.push(row(vec![Span::styled("▎", Style::new().fg(theme.user))]));
    }
    Text::from(lines)
}

fn reasoning(text: &str, finished: bool, theme: &Theme) -> Text<'static> {
    if finished {
        return Text::from(Line::from(Span::styled("✻ thought", theme.dim().italic())));
    }
    let mut lines = vec![Line::from(Span::styled("✻ thinking", theme.dim().italic()))];
    lines.extend(
        text.lines()
            .rev()
            .take(2)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .map(|line| Line::from(Span::styled(format!("  {line}"), theme.dim()))),
    );
    Text::from(lines)
}

/// Tools whose result is the file or search hit itself, which the card leaves out.
const QUIET_TOOLS: [&str; 8] = [
    "read",
    "list",
    "glob",
    "grep",
    "webfetch",
    "websearch",
    "codesearch",
    "skill",
];
const DIFF_TOOLS: [&str; 5] = ["edit", "write", "multiedit", "apply_patch", "patch"];

fn tool(part: &Value, directory: &str, theme: &Theme) -> Text<'static> {
    let state = &part["state"];
    let (marker, color) = match state["status"].as_str() {
        Some("completed") => ("✓", theme.ok),
        Some("error") => ("✗", theme.error),
        _ => ("●", theme.warn),
    };
    let name = part["tool"].as_str().unwrap_or("tool");
    let title = state["title"]
        .as_str()
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| {
            [
                "filePath",
                "path",
                "description",
                "command",
                "pattern",
                "url",
                "query",
            ]
            .iter()
            .find_map(|key| state["input"][key].as_str())
            .unwrap_or_default()
        });
    let title = title.replace(&format!("{directory}/"), "");
    let title = title.as_str();
    let rail = || Span::styled("  │ ", theme.dim());
    let railed = |spans: Vec<Span<'static>>| Line::from([vec![rail()], spans].concat());
    let mut lines = vec![Line::from(vec![
        Span::styled(format!("{marker} "), Style::new().fg(color)),
        Span::styled(name.to_owned(), Style::new().fg(theme.accent).bold()),
        Span::styled(format!("  {title}"), theme.dim()),
    ])];
    if state["error"]
        .as_str()
        .is_some_and(|e| e.contains("rejected permission"))
    {
        lines[0] = Line::from(vec![
            Span::styled("⊘ ", theme.dim()),
            Span::styled(name.to_owned(), theme.dim().bold()),
            Span::styled(format!("  {title} — you rejected this"), theme.dim()),
        ]);
    } else if let Some(error) = state["error"].as_str() {
        lines.push(railed(vec![Span::styled(
            error.to_owned(),
            Style::new().fg(theme.error),
        )]));
    } else if name == "todowrite" {
        lines.extend(
            state["input"]["todos"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|todo| {
                    let (mark, mark_color) = match todo["status"].as_str() {
                        Some("completed") => ("✓", theme.ok),
                        Some("in_progress") => ("◐", theme.warn),
                        _ => ("○", theme.muted),
                    };
                    railed(vec![
                        Span::styled(format!("{mark} "), Style::new().fg(mark_color)),
                        Span::styled(
                            todo["content"].as_str().unwrap_or_default().to_owned(),
                            theme.dim(),
                        ),
                    ])
                }),
        );
    } else if name == "question" {
        if let Some(answer) = state["output"].as_str().and_then(question_answer) {
            lines.push(railed(vec![Span::styled(answer, theme.dim())]));
        }
    } else if DIFF_TOOLS.contains(&name) {
        if let Some(diff) = state["metadata"]["diff"].as_str() {
            lines.extend(
                Diff::new(&strip_diff_header(diff))
                    .styles(theme.diff())
                    .to_text()
                    .lines
                    .into_iter()
                    .take(DIFF_LINES)
                    .map(|mut line| {
                        line.spans.insert(0, rail());
                        line
                    }),
            );
        }
    } else if !QUIET_TOOLS.contains(&name) {
        let output = state["output"].as_str().unwrap_or_default();
        let total = output.lines().count();
        lines.extend(
            output
                .lines()
                .take(TOOL_OUTPUT_LINES)
                .map(|line| railed(vec![Span::styled(line.to_owned(), theme.dim())])),
        );
        if total > TOOL_OUTPUT_LINES {
            lines.push(railed(vec![Span::styled(
                format!("… {} more lines", total - TOOL_OUTPUT_LINES),
                theme.dim(),
            )]));
        }
    }
    Text::from(lines)
}

/// The answers out of the sentence the question tool returns to the model.
fn question_answer(output: &str) -> Option<String> {
    let (_, rest) = output.split_once("questions: ")?;
    Some(
        rest.split(". You can")
            .next()
            .unwrap_or(rest)
            .replace('"', ""),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn plain(transcript: &Transcript, entry: usize) -> String {
        transcript
            .history
            .entry(entry)
            .map(|text| {
                text.lines
                    .iter()
                    .map(|line| {
                        line.spans
                            .iter()
                            .map(|span| span.content.as_ref())
                            .collect::<String>()
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default()
    }

    fn transcript() -> Transcript {
        Transcript::new(Theme::default(), "/work")
    }

    #[test]
    fn a_user_message_gets_a_rail_once_its_role_is_known() {
        let mut t = transcript();
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "text", "text": "hello"}));
        assert!(!plain(&t, 0).contains('▎'));
        t.apply_message(&json!({"id": "m1", "role": "user"}));
        assert!(plain(&t, 0).starts_with("▎ hello"));
    }

    #[test]
    fn deltas_grow_the_part_they_belong_to() {
        let mut t = transcript();
        t.apply_message(&json!({"id": "m1", "role": "assistant"}));
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "text", "text": "he"}));
        t.apply_delta("p1", "text", "llo");
        assert!(plain(&t, 0).contains("hello"));
        assert_eq!(t.last_answer(), Some("hello"));
    }

    #[test]
    fn deltas_for_unknown_parts_are_ignored() {
        let mut t = transcript();
        t.apply_delta("missing", "text", "x");
        assert!(t.history.is_empty());
    }

    #[test]
    fn a_tool_card_shows_its_status_title_and_trimmed_output() {
        let mut t = transcript();
        let output = (1..=10)
            .map(|n| format!("line {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "bash",
            "state": {"status": "completed", "title": "src/main.rs", "output": output}}),
        );
        let card = plain(&t, 0);
        assert!(card.starts_with("✓ bash  src/main.rs"));
        assert!(card.contains("line 6") && !card.contains("line 7"));
        assert!(card.contains("… 4 more lines"));
    }

    #[test]
    fn a_pending_tool_falls_back_to_its_input_for_a_title() {
        let mut t = transcript();
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "write",
            "state": {"status": "pending", "input": {"filePath": "/tmp/x"}}}),
        );
        assert!(plain(&t, 0).starts_with("● write  /tmp/x"));
    }

    #[test]
    fn cost_and_context_follow_the_assistant_messages() {
        let mut t = transcript();
        t.apply_message(&json!({"id": "m1", "role": "assistant", "cost": 0.5, "tokens": {"input": 100, "output": 20, "cache": {"read": 30}}}));
        t.apply_message(&json!({"id": "m2", "role": "assistant", "cost": 0.25, "tokens": {"input": 200, "output": 50, "cache": {"read": 0}}}));
        assert!((t.cost - 0.75).abs() < f64::EPSILON);
        assert_eq!(t.context_tokens, 250);
    }

    #[test]
    fn a_themed_user_message_is_a_filled_card() {
        let mut t = Transcript::new(
            crate::themes::find("tokyonight", crate::themes::Mode::Dark).unwrap(),
            "/work",
        );
        t.apply_message(&json!({"id": "m1", "role": "user"}));
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "text", "text": "hi"}));
        let card = plain(&t, 0);
        assert_eq!(card.lines().count(), 3);
        assert!(card.contains("▎ hi"));
    }

    #[test]
    fn finished_reasoning_collapses_to_one_line() {
        let mut t = transcript();
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "reasoning", "text": "a\nb\nc"}),
        );
        assert!(plain(&t, 0).contains("thinking") && plain(&t, 0).contains("  c"));
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "reasoning", "text": "a\nb\nc", "time": {"start": 1, "end": 2}}));
        assert_eq!(plain(&t, 0).trim(), "✻ thought");
    }

    #[test]
    fn a_todo_card_lists_the_items_and_quiet_tools_show_no_output() {
        let mut t = transcript();
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "todowrite",
            "state": {"status": "completed", "title": "2 todos", "input": {"todos": [
                {"content": "first", "status": "completed"}, {"content": "second", "status": "pending"}]}}}));
        t.apply_part(
            &json!({"id": "p2", "messageID": "m1", "type": "tool", "tool": "read",
            "state": {"status": "completed", "title": "a.rs", "output": "secret file body"}}),
        );
        assert!(plain(&t, 0).contains("✓ first") && plain(&t, 0).contains("○ second"));
        assert!(!plain(&t, 1).contains("secret"));
    }

    #[test]
    fn the_question_tool_shows_the_answer() {
        let mut t = transcript();
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "question",
            "state": {"status": "completed", "title": "Asked 1 question",
                "output": "User has answered your questions: \"Which?\"=\"B\". You can now continue."}}));
        assert!(plain(&t, 0).contains("Which?=B"));
    }

    #[test]
    fn a_finished_assistant_message_gets_a_footer_once() {
        let mut t = transcript();
        let info = json!({"id": "m1", "role": "assistant", "modelID": "fast", "time": {"created": 1000, "completed": 3500}});
        t.apply_message(&info);
        t.apply_message(&info);
        assert_eq!(t.history.len(), 1);
        assert_eq!(plain(&t, 0).trim(), "◇ fast · 2.5s");
    }

    #[test]
    fn a_rejected_tool_reads_as_a_choice_not_an_error() {
        let mut t = transcript();
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "write",
            "state": {"status": "error", "title": "a.md", "input": {},
                "error": "The user rejected permission to use this specific tool call."}}),
        );
        let card = plain(&t, 0);
        assert!(card.starts_with("⊘ write  a.md — you rejected this"));
        assert!(!card.contains("specific tool call"));
    }

    #[test]
    fn the_footer_waits_for_the_end_of_the_turn() {
        let mut t = transcript();
        let step = |finish: &str| json!({"id": "m1", "role": "assistant", "finish": finish, "time": {"created": 0, "completed": 1000}});
        t.apply_message(&step("tool-calls"));
        assert!(t.history.is_empty());
        t.apply_message(&step("stop"));
        assert_eq!(t.history.len(), 1);
    }

    #[test]
    fn diff_headers_are_dropped_but_changes_are_kept() {
        let diff = "Index: /a/b\n===\n--- /a/b\n+++ /a/b\n@@ -1 +1 @@\n-old\n+new";
        assert_eq!(strip_diff_header(diff), "@@ -1 +1 @@\n-old\n+new");
    }

    #[test]
    fn a_stored_message_puts_its_footer_after_its_parts() {
        let mut t = transcript();
        let info = json!({"id": "m1", "role": "assistant", "modelID": "fast", "time": {"created": 0, "completed": 1000}});
        t.apply_stored(
            &info,
            &[json!({"id": "p1", "messageID": "m1", "type": "text", "text": "answer"})],
        );
        assert!(plain(&t, 0).contains("answer"));
        assert!(plain(&t, 1).contains("◇ fast"));
    }

    #[test]
    fn tool_paths_are_shown_relative_to_the_working_directory() {
        let mut t = transcript();
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "write",
            "state": {"status": "pending", "input": {"filePath": "/work/src/a.rs"}}}),
        );
        assert!(plain(&t, 0).contains("  src/a.rs") && !plain(&t, 0).contains("/work"));
    }

    #[test]
    fn the_active_tool_is_the_one_still_running() {
        let mut t = transcript();
        assert_eq!(t.active_tool(), None);
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "tool", "tool": "read",
            "state": {"status": "completed", "title": "a.rs"}}),
        );
        t.apply_part(
            &json!({"id": "p2", "messageID": "m1", "type": "tool", "tool": "write",
            "state": {"status": "running", "input": {"filePath": "/work/notes.md"}}}),
        );
        assert_eq!(t.active_tool().as_deref(), Some("write notes.md"));
    }

    #[test]
    fn mentions_in_a_user_message_get_the_accent_color() {
        let mut t = transcript();
        t.apply_message(&json!({"id": "m1", "role": "user"}));
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "text", "text": "read @src/a.rs now"}),
        );
        let theme = Theme::default();
        let spans = &t.history.entry(0).unwrap().lines[0].spans;
        let mention = spans
            .iter()
            .find(|s| s.content.starts_with("@src"))
            .unwrap();
        assert_eq!(mention.style.fg, Some(theme.accent));
    }

    #[test]
    fn a_very_long_user_message_is_cut_with_a_count_of_the_rest() {
        let mut t = transcript();
        let body = (1..=30)
            .map(|n| format!("row {n}"))
            .collect::<Vec<_>>()
            .join("\n");
        t.apply_message(&json!({"id": "m1", "role": "user"}));
        t.apply_part(&json!({"id": "p1", "messageID": "m1", "type": "text", "text": body}));
        let card = plain(&t, 0);
        assert!(card.contains("row 8") && !card.contains("row 9"));
        assert!(card.contains("… 22 more lines"));
    }

    #[test]
    fn synthetic_text_is_not_shown() {
        let mut t = transcript();
        t.apply_part(
            &json!({"id": "p1", "messageID": "m1", "type": "text", "text": "x", "synthetic": true}),
        );
        assert!(t.history.is_empty());
    }
}
