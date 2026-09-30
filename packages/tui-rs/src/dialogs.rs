//! The dialogs that need an answer: permission requests, questions from the
//! agent, renaming and deleting a session.

use crewtui::text::{Line, Span, Text};
use crewtui::widgets::{Block, BorderType, Clear, Input, InputState, Paragraph};
use crewtui::{Color, Edges, Frame, KeyCode, KeyEvent, Rect, Style};
use crewtui_rich::Diff;
use serde_json::Value;

use crate::theme::Theme;

const DIFF_PREVIEW_LINES: usize = 12;

/// A request to run something the agent is not yet allowed to.
#[derive(Debug, Clone)]
pub struct Permission {
    pub id: String,
    pub action: String,
    pub target: String,
    pub diff: Option<String>,
}

impl Permission {
    pub fn from_event(properties: &Value, directory: &str) -> Self {
        let patterns = properties["patterns"]
            .as_array()
            .map(|p| {
                p.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .unwrap_or_default();
        Self {
            id: properties["id"].as_str().unwrap_or_default().to_owned(),
            action: properties["permission"]
                .as_str()
                .unwrap_or("permission")
                .to_owned(),
            target: properties["metadata"]["filepath"]
                .as_str()
                .map_or(patterns, |path| path.replace(&format!("{directory}/"), "")),
            diff: properties["metadata"]["diff"].as_str().map(str::to_owned),
        }
    }

    /// The reply a key stands for: `once`, `always` or `reject`.
    pub fn reply_for(key: KeyEvent) -> Option<&'static str> {
        match key.code {
            KeyCode::Char('y') | KeyCode::Enter => Some("once"),
            KeyCode::Char('a') => Some("always"),
            KeyCode::Char('n') | KeyCode::Esc => Some("reject"),
            _ => None,
        }
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme) {
        let mut lines = vec![
            Line::from(Span::styled(self.action.clone(), theme.plain().bold())),
            Line::from(Span::styled(self.target.clone(), theme.dim())),
        ];
        if let Some(diff) = &self.diff {
            lines.push(Line::default());
            let shown = Diff::new(&crate::transcript::strip_diff_header(diff))
                .styles(theme.diff())
                .to_text()
                .lines;
            let hidden = shown.len().saturating_sub(DIFF_PREVIEW_LINES);
            lines.extend(shown.into_iter().take(DIFF_PREVIEW_LINES));
            if hidden > 0 {
                lines.push(Line::from(Span::styled(
                    format!("… {hidden} more lines"),
                    theme.dim(),
                )));
            }
        }
        lines.push(Line::default());
        lines.push(Line::from(vec![
            Span::styled("y", Style::new().fg(theme.ok).bold()),
            Span::styled(" allow once    ", theme.dim()),
            Span::styled("a", Style::new().fg(theme.warn).bold()),
            Span::styled(" always (this session)    ", theme.dim()),
            Span::styled("n", Style::new().fg(theme.error).bold()),
            Span::styled(" reject", theme.dim()),
        ]));
        draw_card(frame, area, " permission needed ", theme.warn, lines);
    }
}

/// One question from the agent, with the choices it offers.
#[derive(Debug, Clone)]
pub struct Ask {
    pub header: String,
    pub question: String,
    pub options: Vec<(String, String)>,
    pub multiple: bool,
    pub custom: bool,
}

/// A set of questions, asked one at a time.
pub struct Question {
    pub id: String,
    asks: Vec<Ask>,
    answers: Vec<Vec<String>>,
    cursor: usize,
    checked: Vec<bool>,
    custom: InputState,
}

/// What a key press did to a [`Question`].
#[derive(Debug, PartialEq, Eq)]
pub enum QuestionOutcome {
    Pending,
    Rejected,
    Answered(Vec<Vec<String>>),
}

impl Question {
    pub fn from_event(properties: &Value) -> Self {
        let asks: Vec<Ask> = properties["questions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|q| Ask {
                header: q["header"].as_str().unwrap_or_default().to_owned(),
                question: q["question"].as_str().unwrap_or_default().to_owned(),
                options: q["options"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|o| {
                        (
                            o["label"].as_str().unwrap_or_default().to_owned(),
                            o["description"].as_str().unwrap_or_default().to_owned(),
                        )
                    })
                    .collect(),
                multiple: q["multiple"].as_bool().unwrap_or(false),
                custom: q["custom"].as_bool().unwrap_or(true),
            })
            .collect();
        let checked = vec![false; asks.first().map_or(0, |a| a.options.len())];
        Self {
            id: properties["id"].as_str().unwrap_or_default().to_owned(),
            asks,
            answers: Vec::new(),
            cursor: 0,
            checked,
            custom: InputState::new(),
        }
    }

    fn current(&self) -> &Ask {
        &self.asks[self.answers.len().min(self.asks.len() - 1)]
    }

    /// Rows are the options, then a free-text row when the question allows one.
    fn rows(&self) -> usize {
        self.current().options.len() + usize::from(self.current().custom)
    }

    fn on_custom_row(&self) -> bool {
        self.current().custom && self.cursor == self.current().options.len()
    }

    fn finish_ask(&mut self, answer: Vec<String>) -> QuestionOutcome {
        self.answers.push(answer);
        self.cursor = 0;
        self.custom.clear();
        if self.answers.len() == self.asks.len() {
            return QuestionOutcome::Answered(std::mem::take(&mut self.answers));
        }
        self.checked = vec![false; self.current().options.len()];
        QuestionOutcome::Pending
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> QuestionOutcome {
        if self.asks.is_empty() {
            return QuestionOutcome::Rejected;
        }
        match key.code {
            KeyCode::Esc => QuestionOutcome::Rejected,
            KeyCode::Up => {
                self.cursor = self.cursor.checked_sub(1).unwrap_or(self.rows() - 1);
                QuestionOutcome::Pending
            }
            KeyCode::Down => {
                self.cursor = (self.cursor + 1) % self.rows();
                QuestionOutcome::Pending
            }
            KeyCode::Char(' ') if self.current().multiple && !self.on_custom_row() => {
                self.checked[self.cursor] = !self.checked[self.cursor];
                QuestionOutcome::Pending
            }
            KeyCode::Enter => self.confirm(),
            _ if self.on_custom_row() => {
                self.custom.handle_key(key);
                QuestionOutcome::Pending
            }
            _ => QuestionOutcome::Pending,
        }
    }

    fn confirm(&mut self) -> QuestionOutcome {
        let typed = self.custom.text().trim().to_owned();
        let ask = self.current().clone();
        if self.on_custom_row() {
            return match typed.is_empty() {
                true => QuestionOutcome::Pending,
                false => self.finish_ask(vec![typed]),
            };
        }
        if !ask.multiple {
            return self.finish_ask(vec![ask.options[self.cursor].0.clone()]);
        }
        let mut chosen: Vec<String> = ask
            .options
            .iter()
            .zip(&self.checked)
            .filter(|(_, on)| **on)
            .map(|(o, _)| o.0.clone())
            .collect();
        if !typed.is_empty() {
            chosen.push(typed);
        }
        match chosen.is_empty() {
            true => QuestionOutcome::Pending,
            false => self.finish_ask(chosen),
        }
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme) {
        if self.asks.is_empty() {
            return;
        }
        let ask = self.current();
        let popup = area.centered(72, (self.rows() + 7).min(area.height as usize) as u16);
        frame.render_widget(Clear, popup);
        let title = format!(
            " {} ({}/{}) ",
            ask.header,
            self.answers.len() + 1,
            self.asks.len()
        );
        let block = Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(Style::new().fg(theme.accent))
            .title(Line::from(Span::styled(
                title,
                Style::new().fg(theme.accent).bold(),
            )))
            .padding(Edges::symmetric(0, 1));
        let inner = block.inner(popup);
        frame.render_widget(block, popup);
        let mut lines = vec![
            Line::from(Span::styled(ask.question.clone(), theme.plain().bold())),
            Line::default(),
        ];
        for (n, (label, description)) in ask.options.iter().enumerate() {
            let selected = n == self.cursor;
            let mark = match (ask.multiple, self.checked.get(n).copied().unwrap_or(false)) {
                (true, true) => "[x]",
                (true, false) => "[ ]",
                (false, _) if selected => " ●",
                (false, _) => " ○",
            };
            let style = if selected {
                Style::new().fg(theme.accent).bold()
            } else {
                theme.plain()
            };
            lines.push(Line::from(vec![
                Span::styled(if selected { "▸ " } else { "  " }, style),
                Span::styled(format!("{mark} {label}"), style),
                Span::styled(format!("  {description}"), theme.dim()),
            ]));
        }
        let custom_row = lines.len() as u16;
        if ask.custom {
            let selected = self.on_custom_row();
            let style = if selected {
                Style::new().fg(theme.accent).bold()
            } else {
                theme.dim()
            };
            lines.push(Line::from(vec![
                Span::styled(if selected { "▸ " } else { "  " }, style),
                Span::styled("type your own answer", style),
            ]));
        }
        frame.render_widget(Paragraph::new(Text::from(lines)), inner);
        if self.on_custom_row() {
            let field = Rect::new(
                inner.x + 24,
                inner.y + custom_row,
                inner.width.saturating_sub(24),
                1,
            );
            frame.render_stateful_widget(Input::new().style(theme.plain()), field, &self.custom);
        }
        let hint = if ask.multiple {
            "space toggle   enter confirm   esc dismiss"
        } else {
            "enter choose   esc dismiss"
        };
        let footer = Rect::new(
            inner.x,
            inner.y + inner.height.saturating_sub(1),
            inner.width,
            1,
        );
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(hint, theme.dim()))),
            footer,
        );
    }
}

/// A one-line text dialog, used to rename a session and to ask for keys, codes and other short answers.
pub struct TextDialog {
    pub title: String,
    input: InputState,
    masked: bool,
    notes: Vec<Line<'static>>,
    placeholder: String,
}

/// What a key press did to a [`TextDialog`].
#[derive(Debug, PartialEq, Eq)]
pub enum TextOutcome {
    Pending,
    Cancelled,
    Submitted(String),
}

impl TextDialog {
    pub fn new(title: &str, initial: &str) -> Self {
        Self {
            title: title.to_owned(),
            input: InputState::with_text(initial),
            masked: false,
            notes: Vec::new(),
            placeholder: String::new(),
        }
    }

    /// Draws a dot for every character typed, for a key or a password.
    pub fn masked(mut self) -> Self {
        self.masked = true;
        self
    }

    /// Text shown while the field is empty.
    pub fn placeholder(mut self, placeholder: &str) -> Self {
        self.placeholder = placeholder.to_owned();
        self
    }

    /// Lines shown above the field, such as instructions.
    pub fn notes(mut self, notes: Vec<Line<'static>>) -> Self {
        self.notes = notes;
        self
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> TextOutcome {
        match key.code {
            KeyCode::Esc => TextOutcome::Cancelled,
            KeyCode::Enter if !self.input.text().trim().is_empty() => {
                TextOutcome::Submitted(self.input.text().trim().to_owned())
            }
            _ => {
                self.input.handle_key(key);
                TextOutcome::Pending
            }
        }
    }

    pub fn paste(&mut self, text: &str) {
        self.input.insert_str(text.trim_end_matches(['\r', '\n']));
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme) {
        let popup = area.centered(72, self.notes.len() as u16 + 3);
        frame.render_widget(Clear, popup);
        let block = Block::bordered()
            .border_type(BorderType::Rounded)
            .border_style(Style::new().fg(theme.accent))
            .title(Line::from(Span::styled(
                format!(" {} ", self.title),
                Style::new().fg(theme.accent).bold(),
            )));
        let inner = block.inner(popup);
        frame.render_widget(block, popup);
        let notes = self.notes.len() as u16;
        if notes > 0 {
            frame.render_widget(
                Paragraph::new(Text::from(self.notes.clone())),
                Rect::new(inner.x, inner.y, inner.width, notes),
            );
        }
        let mut field = Input::new()
            .style(theme.plain())
            .placeholder(&self.placeholder)
            .placeholder_style(theme.dim());
        if self.masked {
            field = field.mask('•');
        }
        frame.render_stateful_widget(
            field,
            Rect::new(inner.x, inner.y + notes, inner.width, 1),
            &self.input,
        );
    }
}

/// Draws a bordered card at the bottom of `area`, sized to its lines.
pub fn draw_card(
    frame: &mut Frame<'_>,
    area: Rect,
    title: &str,
    color: Color,
    lines: Vec<Line<'static>>,
) {
    let height = (lines.len() as u16 + 2).min(area.height);
    let card = Rect::new(area.x, area.y + area.height - height, area.width, height);
    frame.render_widget(Clear, card);
    frame.render_widget(
        Paragraph::new(Text::from(lines)).block(
            Block::bordered()
                .border_type(BorderType::Rounded)
                .border_style(Style::new().fg(color))
                .title(Line::from(Span::styled(
                    title.to_owned(),
                    Style::new().fg(color).bold(),
                )))
                .padding(Edges::symmetric(0, 1)),
        ),
        card,
    );
}

/// Draws a small confirmation card in the middle of `area`.
pub fn draw_confirm(frame: &mut Frame<'_>, area: Rect, message: &str, theme: &Theme) {
    let popup = area.centered(56, 5);
    frame.render_widget(Clear, popup);
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(theme.error))
        .padding(Edges::symmetric(0, 1));
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    frame.render_widget(
        Paragraph::new(Text::from(vec![
            Line::from(Span::styled(message.to_owned(), theme.plain().bold())),
            Line::default(),
            Line::from(vec![
                Span::styled("y", Style::new().fg(theme.error).bold()),
                Span::styled(" confirm    ", theme.dim()),
                Span::styled("n", theme.key()),
                Span::styled(" cancel", theme.dim()),
            ]),
        ])),
        inner,
    );
}

#[cfg(test)]
mod tests {
    use crewtui::KeyModifiers;
    use serde_json::json;

    use super::*;

    fn press(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn question(multiple: bool) -> Question {
        Question::from_event(&json!({
            "id": "que_1",
            "questions": [
                {"header": "Pick", "question": "Which?", "multiple": multiple,
                 "options": [{"label": "a", "description": "first"}, {"label": "b", "description": "second"}]},
                {"header": "Then", "question": "Again?", "options": [{"label": "x", "description": ""}]}
            ]
        }))
    }

    #[test]
    fn a_single_choice_answers_each_question_in_turn() {
        let mut q = question(false);
        q.handle_key(press(KeyCode::Down));
        assert_eq!(
            q.handle_key(press(KeyCode::Enter)),
            QuestionOutcome::Pending
        );
        assert_eq!(
            q.handle_key(press(KeyCode::Enter)),
            QuestionOutcome::Answered(vec![vec!["b".to_owned()], vec!["x".to_owned()]])
        );
    }

    #[test]
    fn a_multiple_choice_collects_the_checked_options() {
        let mut q = question(true);
        q.handle_key(press(KeyCode::Char(' ')));
        q.handle_key(press(KeyCode::Down));
        q.handle_key(press(KeyCode::Char(' ')));
        q.handle_key(press(KeyCode::Enter));
        let QuestionOutcome::Answered(answers) = q.handle_key(press(KeyCode::Enter)) else {
            panic!("not answered")
        };
        assert_eq!(answers[0], ["a", "b"]);
    }

    #[test]
    fn a_multiple_choice_needs_at_least_one_option() {
        let mut q = question(true);
        assert_eq!(
            q.handle_key(press(KeyCode::Enter)),
            QuestionOutcome::Pending
        );
    }

    #[test]
    fn a_typed_answer_is_used_on_the_free_text_row() {
        let mut q = question(false);
        q.handle_key(press(KeyCode::Up));
        "hey".chars().for_each(|c| {
            q.handle_key(press(KeyCode::Char(c)));
        });
        q.handle_key(press(KeyCode::Enter));
        let QuestionOutcome::Answered(answers) = q.handle_key(press(KeyCode::Enter)) else {
            panic!("not answered")
        };
        assert_eq!(answers[0], ["hey"]);
    }

    #[test]
    fn escape_dismisses_a_question() {
        assert_eq!(
            question(false).handle_key(press(KeyCode::Esc)),
            QuestionOutcome::Rejected
        );
    }

    #[test]
    fn permission_keys_map_to_replies() {
        assert_eq!(
            Permission::reply_for(press(KeyCode::Char('y'))),
            Some("once")
        );
        assert_eq!(
            Permission::reply_for(press(KeyCode::Char('a'))),
            Some("always")
        );
        assert_eq!(Permission::reply_for(press(KeyCode::Esc)), Some("reject"));
        assert_eq!(Permission::reply_for(press(KeyCode::Char('x'))), None);
    }

    #[test]
    fn a_permission_prefers_the_file_path_and_keeps_the_diff() {
        let permission = Permission::from_event(
            &json!({
                "id": "per_1", "permission": "edit", "patterns": ["src/*"],
                "metadata": {"filepath": "/work/src/main.rs", "diff": "@@ -1 +1 @@\n-a\n+b"}
            }),
            "/work",
        );
        assert_eq!(permission.target, "src/main.rs");
        assert!(permission.diff.is_some());
    }

    #[test]
    fn the_text_dialog_submits_trimmed_text_and_refuses_blank() {
        let mut dialog = TextDialog::new("Rename", "  ");
        assert_eq!(
            dialog.handle_key(press(KeyCode::Enter)),
            TextOutcome::Pending
        );
        dialog.handle_key(press(KeyCode::Char('x')));
        assert_eq!(
            dialog.handle_key(press(KeyCode::Enter)),
            TextOutcome::Submitted("x".to_owned())
        );
    }
}
