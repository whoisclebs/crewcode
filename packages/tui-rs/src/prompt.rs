//! The message the user is typing, and the prompts sent before it.

use crewtui::widgets::{TextArea, TextAreaState};
use crewtui::{Frame, KeyCode, KeyEvent, Rect};

use crate::theme::Theme;

const MAX_ROWS: u16 = 8;

pub struct Prompt {
    input: TextAreaState,
    history: Vec<String>,
    /// Which earlier prompt is shown, counted from the newest, while browsing.
    browsing: Option<usize>,
    /// What was typed before browsing started, restored on the way back.
    draft: String,
}

impl Prompt {
    pub fn new(history: Vec<String>) -> Self {
        Self {
            input: TextAreaState::new(),
            history,
            browsing: None,
            draft: String::new(),
        }
    }

    pub fn text(&self) -> &str {
        self.input.text()
    }

    pub fn is_empty(&self) -> bool {
        self.input.is_empty()
    }

    pub fn set_text(&mut self, text: &str) {
        self.input.set_text(text);
        self.browsing = None;
    }

    pub fn clear(&mut self) {
        self.set_text("");
    }

    pub fn insert(&mut self, text: &str) {
        self.input.insert_str(text);
    }

    pub fn newline(&mut self) {
        self.input.insert_newline();
    }

    /// True when the text ends in a backslash, which Enter turns into a newline instead of sending.
    pub fn continues_on_next_line(&mut self) -> bool {
        let Some(without) = self.input.text().strip_suffix('\\').map(str::to_owned) else {
            return false;
        };
        self.input.set_text(&without);
        self.input.insert_newline();
        true
    }

    /// Takes the text to send, trimmed, and empties the field.
    pub fn take(&mut self) -> String {
        let text = self.input.text().trim().to_owned();
        self.clear();
        text
    }

    pub fn remember(&mut self, sent: &str) {
        self.history.retain(|earlier| earlier != sent);
        self.history.push(sent.to_owned());
    }

    /// Edits the text. Up and Down move through earlier prompts once the cursor is on the first or last row.
    pub fn handle_key(&mut self, key: KeyEvent) {
        let consumed = self.input.handle_key(key);
        match key.code {
            KeyCode::Up if !consumed => self.older(),
            KeyCode::Down if !consumed => self.newer(),
            KeyCode::Up | KeyCode::Down => {}
            _ => self.browsing = None,
        }
    }

    /// Shows the previous prompt, starting from the newest.
    pub fn older(&mut self) {
        let next = self.browsing.map_or(0, |n| n + 1);
        if next >= self.history.len() {
            return;
        }
        if self.browsing.is_none() {
            self.draft = self.input.text().to_owned();
        }
        self.browsing = Some(next);
        self.input
            .set_text(&self.history[self.history.len() - 1 - next]);
    }

    /// Shows the next prompt, and at the end what was being typed.
    pub fn newer(&mut self) {
        match self.browsing {
            None => {}
            Some(0) => {
                self.browsing = None;
                self.input.set_text(&self.draft);
            }
            Some(n) => {
                self.browsing = Some(n - 1);
                self.input.set_text(&self.history[self.history.len() - n]);
            }
        }
    }

    /// Rows the field needs at `width`, up to a limit.
    pub fn rows(&self, width: u16) -> u16 {
        self.input.desired_height(width, MAX_ROWS)
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme) {
        frame.render_stateful_widget(
            TextArea::new()
                .placeholder("Ask CrewCode anything…")
                .placeholder_style(theme.dim())
                .style(theme.plain()),
            area,
            &self.input,
        );
    }
}

#[cfg(test)]
mod tests {
    use crewtui::KeyModifiers;

    use super::*;

    fn prompt() -> Prompt {
        Prompt::new(vec!["first".to_owned(), "second".to_owned()])
    }

    fn press(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn browsing_walks_back_and_returns_to_the_draft() {
        let mut prompt = prompt();
        prompt.insert("draft");
        prompt.older();
        assert_eq!(prompt.text(), "second");
        prompt.older();
        assert_eq!(prompt.text(), "first");
        prompt.older();
        assert_eq!(prompt.text(), "first");
        prompt.newer();
        assert_eq!(prompt.text(), "second");
        prompt.newer();
        assert_eq!(prompt.text(), "draft");
    }

    #[test]
    fn up_on_the_only_row_recalls_history_and_typing_stops_browsing() {
        let mut prompt = prompt();
        prompt.handle_key(press(KeyCode::Up));
        assert_eq!(prompt.text(), "second");
        prompt.handle_key(press(KeyCode::Char('!')));
        prompt.handle_key(press(KeyCode::Up));
        assert_eq!(prompt.text(), "second");
        prompt.handle_key(press(KeyCode::Down));
        assert_eq!(prompt.text(), "second!");
    }

    #[test]
    fn take_trims_and_empties() {
        let mut prompt = prompt();
        prompt.insert("  hello  ");
        assert_eq!(prompt.take(), "hello");
        assert!(prompt.is_empty());
    }

    #[test]
    fn a_trailing_backslash_becomes_a_newline() {
        let mut prompt = prompt();
        prompt.insert("one\\");
        assert!(prompt.continues_on_next_line());
        prompt.insert("two");
        assert_eq!(prompt.text(), "one\ntwo");
        assert!(!prompt.continues_on_next_line());
    }

    #[test]
    fn the_field_grows_with_its_lines_up_to_a_limit() {
        let mut prompt = prompt();
        assert_eq!(prompt.rows(40), 1);
        (0..3).for_each(|_| prompt.newline());
        assert_eq!(prompt.rows(40), 4);
        (0..20).for_each(|_| prompt.newline());
        assert_eq!(prompt.rows(40), MAX_ROWS);
    }
}
