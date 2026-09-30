//! A filterable list in a dialog: the model and agent selectors, the session
//! list and the command palette are all one of these.

use crewtui::text::{Line, Span};
use crewtui::widgets::{Block, BorderType, Clear, Input, InputState, List, ListState, Paragraph};
use crewtui::{Constraint, Frame, KeyCode, KeyEvent, Layout, Rect, Style};

#[cfg(test)]
use crewtui::KeyModifiers;

use crate::theme::Theme;
use crate::view::ellipsize;

const MAX_WIDTH: u16 = 76;
const MAX_ROWS: usize = 14;

/// One row of a picker and the value it stands for.
#[derive(Debug, Clone)]
pub struct Entry<T> {
    pub label: String,
    pub detail: String,
    pub value: T,
    /// The choice in effect now: marked with a dot, and where the picker opens.
    pub current: bool,
}

impl<T> Entry<T> {
    pub fn new(label: impl Into<String>, detail: impl Into<String>, value: T) -> Self {
        Self {
            label: label.into(),
            detail: detail.into(),
            value,
            current: false,
        }
    }

    pub fn current(mut self, current: bool) -> Self {
        self.current = current;
        self
    }
}

/// What a key press did to a picker.
#[derive(Debug, PartialEq, Eq)]
pub enum Outcome<T> {
    Pending,
    Cancelled,
    Chosen(T),
}

pub struct Picker<T> {
    title: String,
    entries: Vec<Entry<T>>,
    filter: InputState,
    selection: ListState,
}

/// How well `query` matches `text`: 0 for a substring, 1 for letters in
/// order, `None` for no match.
fn score(query: &str, text: &str) -> Option<u8> {
    let (query, text) = (query.to_lowercase(), text.to_lowercase());
    if text.contains(&query) {
        return Some(0);
    }
    let mut letters = text.chars();
    query
        .chars()
        .all(|wanted| letters.any(|c| c == wanted))
        .then_some(1)
}

impl<T: Clone> Picker<T> {
    pub fn new(title: impl Into<String>, entries: Vec<Entry<T>>) -> Self {
        let mut picker = Self {
            title: title.into(),
            entries,
            filter: InputState::new(),
            selection: ListState::new(),
        };
        let opening = picker
            .entries
            .iter()
            .position(|entry| entry.current)
            .or((!picker.entries.is_empty()).then_some(0));
        picker.selection.select(opening);
        picker
    }

    /// Opens with `query` already typed, as when `/` starts the command palette.
    pub fn with_query(mut self, query: &str) -> Self {
        self.filter.set_text(query);
        self.reset_selection();
        self
    }

    /// The entries matching the filter, best first.
    pub fn visible(&self) -> Vec<&Entry<T>> {
        let query = self.filter.text().trim();
        if query.is_empty() {
            return self.entries.iter().collect();
        }
        let mut scored: Vec<(u8, &Entry<T>)> = self
            .entries
            .iter()
            .filter_map(|entry| {
                score(query, &format!("{} {}", entry.label, entry.detail)).map(|s| (s, entry))
            })
            .collect();
        scored.sort_by_key(|(s, _)| *s);
        scored.into_iter().map(|(_, entry)| entry).collect()
    }

    /// Puts the cursor on the first row, whatever the current entry is.
    pub fn at_top(mut self) -> Self {
        self.selection
            .select((!self.entries.is_empty()).then_some(0));
        self
    }

    /// Puts the cursor on the first entry whose value satisfies `wanted`, if any.
    pub fn select_matching(&mut self, wanted: impl Fn(&T) -> bool) {
        if let Some(index) = self.visible().iter().position(|entry| wanted(&entry.value)) {
            self.selection.select(Some(index));
        }
    }

    /// The value under the cursor.
    pub fn highlighted(&self) -> Option<&T> {
        self.selection
            .selected()
            .and_then(|i| self.visible().get(i).map(|entry| &entry.value))
    }

    fn reset_selection(&mut self) {
        let any = !self.visible().is_empty();
        self.selection.select(any.then_some(0));
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> Outcome<T> {
        let count = self.visible().len();
        match key.code {
            KeyCode::Esc => Outcome::Cancelled,
            KeyCode::Up => {
                self.selection.select_previous(count);
                Outcome::Pending
            }
            KeyCode::Down => {
                self.selection.select_next(count);
                Outcome::Pending
            }
            KeyCode::Enter => match self
                .selection
                .selected()
                .and_then(|i| self.visible().get(i).copied())
            {
                Some(entry) => Outcome::Chosen(entry.value.clone()),
                None => Outcome::Pending,
            },
            _ => {
                if self.filter.handle_key(key) {
                    self.reset_selection();
                }
                Outcome::Pending
            }
        }
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme) {
        let visible = self.visible();
        let rows = visible.len().clamp(1, MAX_ROWS) as u16;
        let popup = area.centered(MAX_WIDTH, rows + 4);
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
        let [filter, list] = Layout::column()
            .constraints([Constraint::Fixed(2), Constraint::Fill(1)])
            .split_array(inner);
        let [glyph, field] = Layout::row()
            .constraints([Constraint::Fixed(3), Constraint::Fill(1)])
            .split_array(Rect::new(filter.x, filter.y, filter.width, 1));
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                " ❯",
                Style::new().fg(theme.accent).bold(),
            ))),
            glyph,
        );
        frame.render_stateful_widget(
            Input::new()
                .placeholder("type to filter")
                .placeholder_style(theme.dim())
                .style(theme.plain()),
            field,
            &self.filter,
        );
        if visible.is_empty() {
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled("  no matches", theme.dim()))),
                list,
            );
            return;
        }
        let width = list.width.saturating_sub(4) as usize;
        let items = visible.iter().map(|entry| {
            let label = ellipsize(&entry.label, width.saturating_sub(4));
            let detail = ellipsize(
                &entry.detail,
                width.saturating_sub(label.chars().count() + 4),
            );
            let gap = width
                .saturating_sub(label.chars().count() + detail.chars().count() + 2)
                .max(2);
            let marker = if entry.current {
                Span::styled("● ", Style::new().fg(theme.ok))
            } else {
                Span::raw("  ")
            };
            Line::from(vec![
                marker,
                Span::styled(label, theme.plain()),
                Span::raw(" ".repeat(gap)),
                Span::styled(detail, theme.dim()),
            ])
        });
        frame.render_stateful_widget(
            List::new(items)
                .highlight_symbol("▸ ")
                .highlight_style(Style::new().fg(theme.accent).bold()),
            list,
            &self.selection,
        );
        let hidden = self.selection.hidden_below();
        if hidden > 0 {
            let label = format!(" ↓ {hidden} more ");
            let width = label.chars().count() as u16;
            let at = Rect::new(
                popup.x + popup.width.saturating_sub(width + 2),
                popup.y + popup.height - 1,
                width,
                1,
            );
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(label, theme.dim()))),
                at,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picker() -> Picker<u8> {
        Picker::new(
            "test",
            vec![
                Entry::new("Claude Sonnet", "anthropic", 1),
                Entry::new("GPT Mini", "openai", 2),
                Entry::new("Gemini Pro", "google", 3),
            ],
        )
    }

    fn typed(picker: &mut Picker<u8>, text: &str) {
        text.chars().for_each(|c| {
            picker.handle_key(KeyEvent::new(KeyCode::Char(c), KeyModifiers::NONE));
        });
    }

    #[test]
    fn typing_narrows_the_list_and_enter_chooses() {
        let mut picker = picker();
        typed(&mut picker, "gpt");
        assert_eq!(picker.visible().len(), 1);
        assert_eq!(
            picker.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            Outcome::Chosen(2)
        );
    }

    #[test]
    fn letters_in_order_match_and_substrings_rank_first() {
        let mut picker = picker();
        typed(&mut picker, "gp");
        let labels: Vec<_> = picker.visible().iter().map(|e| e.label.as_str()).collect();
        assert_eq!(labels, ["GPT Mini", "Gemini Pro"]);
    }

    #[test]
    fn no_match_leaves_enter_pending_and_escape_cancels() {
        let mut picker = picker();
        typed(&mut picker, "zzz");
        assert_eq!(
            picker.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            Outcome::Pending
        );
        assert_eq!(
            picker.handle_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE)),
            Outcome::Cancelled
        );
    }

    #[test]
    fn the_picker_opens_on_the_current_entry() {
        let picker = Picker::new(
            "test",
            vec![
                Entry::new("a", "", 1),
                Entry::new("b", "", 2).current(true),
                Entry::new("c", "", 3),
            ],
        );
        assert_eq!(picker.highlighted(), Some(&2));
    }

    #[test]
    fn arrows_move_the_choice() {
        let mut picker = picker();
        picker.handle_key(KeyEvent::new(KeyCode::Down, KeyModifiers::NONE));
        assert_eq!(
            picker.handle_key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE)),
            Outcome::Chosen(2)
        );
    }
}
