//! Drawing the interface.

use crewtui::text::{HorizontalAlign, Line, Span, Text};
use crewtui::widgets::{Block, BorderType, Clear, History, Paragraph, Scrollbar};
use crewtui::{Color, Constraint, Frame, Layout, Rect, Style};

use crate::app::{CrewCode, Dialog};
use crate::theme::Theme;

/// The widest the conversation text is drawn, in columns.
const MAX_PROSE_WIDTH: u16 = 104;
const SUGGESTIONS_SHOWN: usize = 8;
const SIDEBAR_WIDTH: u16 = 34;
const SIDEBAR_MIN_TERMINAL: u16 = 112;

pub fn draw(app: &CrewCode, frame: &mut Frame<'_>) {
    let area = frame.area();
    if app.theme.paints {
        frame.render_widget(
            Block::new().style(Style::new().bg(app.theme.background).fg(app.theme.text)),
            area,
        );
    }
    let permission_open = app.permission.is_some();
    let input_height = app.prompt.rows(area.width.saturating_sub(5)) + 2;
    let [header, main, input, footer] = Layout::column()
        .constraints([
            Constraint::Fixed(2),
            Constraint::Fill(1),
            Constraint::Fixed(input_height),
            Constraint::Fixed(1),
        ])
        .split_array(area);

    draw_header(app, frame, header);

    let show_sidebar = app.sidebar && area.width >= SIDEBAR_MIN_TERMINAL && app.session.is_some();
    let (body, sidebar) = if show_sidebar {
        let [body, sidebar] = Layout::row()
            .constraints([Constraint::Fill(1), Constraint::Fixed(SIDEBAR_WIDTH)])
            .split_array(main);
        (body, Some(sidebar))
    } else {
        (main, None)
    };
    if app.transcript.history.is_empty() {
        draw_welcome(app, frame, body);
    } else {
        draw_transcript(app, frame, body);
    }
    if let Some(sidebar) = sidebar {
        draw_sidebar(app, frame, sidebar);
    }

    draw_suggestions(app, frame, main);
    draw_input(app, frame, input, permission_open);
    draw_status_row(app, frame, footer, sidebar.is_some());
    draw_overlays(app, frame, area, main);
}

fn draw_header(app: &CrewCode, frame: &mut Frame<'_>, area: Rect) {
    let theme = &app.theme;
    let title = if app.session_title.is_empty() {
        app.client.directory()
    } else {
        app.session_title.clone()
    };
    let title = if app.parent_session.is_some() {
        format!("↳ {title}")
    } else {
        title
    };
    let title = ellipsize(&title, area.width.saturating_sub(16) as usize);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(" ◆ ", Style::new().fg(theme.accent)),
            Span::styled("crewcode", theme.plain().bold()),
            Span::styled(format!("  {title}"), theme.dim()),
        ])),
        Rect::new(area.x, area.y, area.width, 1),
    );
    frame.render_widget(
        Paragraph::new("─".repeat(area.width as usize)).style(theme.dim()),
        Rect::new(area.x, area.y + 1, area.width, 1),
    );
}

fn draw_transcript(app: &CrewCode, frame: &mut Frame<'_>, area: Rect) {
    let [_, text, bar] = Layout::row()
        .constraints([
            Constraint::Fixed(2),
            Constraint::Fill(1),
            Constraint::Fixed(1),
        ])
        .split_array(area);
    // Long lines are hard to read: keep the text to a comfortable measure and leave the rest empty.
    let text = Rect::new(text.x, text.y, text.width.min(MAX_PROSE_WIDTH), text.height);
    let history = &app.transcript.history;
    frame.render_stateful_widget(History::new(), text, history);
    if history.content_rows() <= history.viewport_rows() {
        return;
    }
    frame.render_widget(
        Scrollbar::vertical()
            .content(history.content_rows())
            .viewport(history.viewport_rows())
            .position(history.position())
            .styles(Style::new(), app.theme.dim()),
        bar,
    );
}

const WORDMARK: [&str; 2] = [
    "█▀▀ █▀█ █▀▀ █ █ █ █▀▀ █▀█ █▀▄ █▀▀",
    "█▄▄ █▀▄ ██▄ ▀▄▀▄▀ █▄▄ █▄█ █▄▀ ██▄",
];

fn draw_welcome(app: &CrewCode, frame: &mut Frame<'_>, area: Rect) {
    let theme = &app.theme;
    let width = WORDMARK[1].chars().count() as u16;
    let mut lines: Vec<Line<'_>> = WORDMARK
        .iter()
        .map(|row| {
            Line::from(
                row.chars()
                    .enumerate()
                    .map(|(column, c)| {
                        Span::styled(
                            c.to_string(),
                            Style::new().fg(gradient(
                                theme.accent,
                                theme.keyword,
                                column as u16,
                                width,
                            )),
                        )
                    })
                    .collect::<Vec<_>>(),
            )
        })
        .collect();
    lines.push(Line::default());
    lines.push(Line::from(Span::styled(
        "your terminal coding agent",
        theme.dim(),
    )));
    if app.models.is_empty() {
        lines.push(Line::default());
        lines.push(Line::from(vec![
            Span::styled("no provider connected yet · ", Style::new().fg(theme.warn)),
            Span::styled("ctrl+k", theme.key()),
            Span::styled(" to connect one", Style::new().fg(theme.warn)),
        ]));
    }
    lines.push(Line::default());
    for (key, action) in [
        ("enter", "send a message"),
        ("/", "skills and commands"),
        ("ctrl+p", "command palette"),
        ("ctrl+o", "resume a session"),
        ("tab", "switch agent"),
        ("ctrl+s", "switch model"),
    ] {
        lines.push(Line::from(vec![
            Span::styled(format!("{key:>7}  "), theme.key()),
            Span::styled(format!("{action:<22}"), theme.dim()),
        ]));
    }
    let height = lines.len() as u16;
    let top = area.height.saturating_sub(height) / 2;
    frame.render_widget(
        Paragraph::new(Text::from(lines)).align(HorizontalAlign::Center),
        Rect::new(area.x, area.y + top, area.width, height.min(area.height)),
    );
}

/// A color a fraction of the way from `from` to `to`; named colors stay as they are.
fn gradient(from: Color, to: Color, step: u16, steps: u16) -> Color {
    match (from, to) {
        (Color::Rgb(r1, g1, b1), Color::Rgb(r2, g2, b2)) => {
            let mix = |a: u8, b: u8| {
                (i32::from(a)
                    + (i32::from(b) - i32::from(a)) * i32::from(step) / i32::from(steps.max(1)))
                    as u8
            };
            Color::Rgb(mix(r1, r2), mix(g1, g2), mix(b1, b2))
        }
        _ => from,
    }
}

fn draw_sidebar(app: &CrewCode, frame: &mut Frame<'_>, area: Rect) {
    let theme = &app.theme;
    let rail = Rect::new(area.x, area.y, 1, area.height);
    frame.render_widget(
        Paragraph::new(Text::from(vec![
            Line::from(Span::styled("│", theme.dim()));
            area.height as usize
        ])),
        rail,
    );
    let inner = Rect::new(
        area.x + 2,
        area.y,
        area.width.saturating_sub(3),
        area.height,
    );
    let heading = |text: &str| {
        Line::from(Span::styled(
            text.to_owned(),
            Style::new().fg(theme.accent).bold(),
        ))
    };
    let mut lines = vec![
        heading("session"),
        Line::from(Span::styled(
            app.session_title.clone(),
            theme.plain().bold(),
        )),
        Line::default(),
    ];
    lines.push(heading("context"));
    lines.push(Line::from(Span::styled(
        format!("{} tokens", thousands(app.transcript.context_tokens)),
        theme.dim(),
    )));
    if let Some(usage) = app.context_usage() {
        let mut bar = meter(usage, inner.width.saturating_sub(5) as usize, theme);
        bar.push(Span::styled(
            format!(" {:>3}%", (usage * 100.0).round() as u32),
            theme.dim(),
        ));
        lines.push(Line::from(bar));
    }
    let spent = if app.transcript.cost > 0.0 && app.transcript.cost < 0.01 {
        "<$0.01".to_owned()
    } else {
        format!("${:.2}", app.transcript.cost)
    };
    lines.push(Line::from(Span::styled(
        format!("{spent} spent"),
        theme.dim(),
    )));
    lines.push(Line::default());
    if !app.todos.is_empty() {
        lines.push(heading("todo"));
        lines.extend(app.todos.iter().map(|todo| {
            let (mark, color) = match todo.status.as_str() {
                "completed" => ("✓", theme.ok),
                "in_progress" => ("◐", theme.warn),
                "cancelled" => ("✗", theme.muted),
                _ => ("○", theme.muted),
            };
            let style = if todo.status == "completed" || todo.status == "cancelled" {
                theme.dim()
            } else {
                theme.plain()
            };
            Line::from(vec![
                Span::styled(format!("{mark} "), Style::new().fg(color)),
                Span::styled(todo.content.clone(), style),
            ])
        }));
        lines.push(Line::default());
    }
    lines.push(heading("approval"));
    lines.push(Line::from(Span::styled(
        app.permission_mode.clone(),
        theme.dim(),
    )));
    if let Some(branch) = &app.branch {
        lines.push(Line::default());
        lines.push(heading("branch"));
        lines.push(Line::from(Span::styled(format!(" {branch}"), theme.dim())));
    }
    if !app.mcp.is_empty() {
        lines.push(Line::default());
        lines.push(heading("mcp"));
        lines.extend(app.mcp.iter().map(|(name, status)| {
            let color = if status == "connected" {
                theme.ok
            } else {
                theme.muted
            };
            Line::from(vec![
                Span::styled("● ", Style::new().fg(color)),
                Span::styled(name.clone(), theme.dim()),
            ])
        }));
    }
    frame.render_widget(
        Paragraph::new(Text::from(lines)).wrap(crewtui::widgets::Wrap::Word),
        inner,
    );
}

/// A bar `width` cells wide filled to `usage`, in eighths of a cell, green until 60% and red from 85%.
pub fn meter(usage: f64, width: usize, theme: &Theme) -> Vec<Span<'static>> {
    const EIGHTHS: [&str; 8] = [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
    let color = if usage >= 0.85 {
        theme.error
    } else if usage >= 0.6 {
        theme.warn
    } else {
        theme.ok
    };
    let eighths = (usage.clamp(0.0, 1.0) * width as f64 * 8.0).round() as usize;
    let (full, part) = (eighths / 8, eighths % 8);
    let mut spans = vec![Span::styled("█".repeat(full), Style::new().fg(color))];
    let mut used = full;
    if part > 0 {
        spans.push(Span::styled(EIGHTHS[part], Style::new().fg(color)));
        used += 1;
    }
    spans.push(Span::styled(
        "░".repeat(width.saturating_sub(used)),
        theme.dim(),
    ));
    spans
}

fn thousands(value: u64) -> String {
    let digits = value.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// The first sentence of `text`, for a one-line description.
pub fn first_sentence(text: &str) -> &str {
    let line = text.lines().next().unwrap_or_default();
    line.split_once(". ")
        .map_or(line, |(sentence, _)| sentence)
        .trim_end_matches('.')
}

/// The commands, skills and files that complete the word being typed, above the message field.
fn draw_suggestions(app: &CrewCode, frame: &mut Frame<'_>, area: Rect) {
    let suggestions = app.suggestions();
    if suggestions.is_empty() {
        return;
    }
    let theme = &app.theme;
    let shown = suggestions.len().min(SUGGESTIONS_SHOWN);
    let selected = app.suggestion.min(suggestions.len() - 1);
    let first = (selected + 1).saturating_sub(shown);
    let popup = Rect::new(
        area.x + 1,
        area.y + area.height.saturating_sub(shown as u16 + 2),
        area.width.min(84).saturating_sub(2),
        (shown as u16 + 2).min(area.height),
    );
    frame.render_widget(Clear, popup);
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(theme.dim());
    let inner = block.inner(popup);
    frame.render_widget(block, popup);
    let name_width = suggestions
        .iter()
        .map(|s| s.insert.chars().count())
        .max()
        .unwrap_or(0)
        .min(34)
        + 2;
    let tag_width = if suggestions.iter().any(|s| !s.tag.is_empty()) {
        7
    } else {
        0
    };
    let detail_width = (inner.width as usize).saturating_sub(2 + name_width + tag_width);
    let lines: Vec<Line<'_>> = suggestions
        .iter()
        .enumerate()
        .skip(first)
        .take(shown)
        .map(|(n, suggestion)| {
            let on = n == selected;
            let name_style = if on {
                Style::new().fg(theme.accent).bold()
            } else {
                theme.plain()
            };
            Line::from(vec![
                Span::styled(if on { "▸ " } else { "  " }, name_style),
                Span::styled(
                    format!(
                        "{:<name_width$}",
                        ellipsize(&suggestion.insert, name_width - 1)
                    ),
                    name_style,
                ),
                Span::styled(
                    format!("{:<tag_width$}", suggestion.tag),
                    Style::new().fg(theme.keyword),
                ),
                Span::styled(
                    ellipsize(first_sentence(&suggestion.detail), detail_width),
                    theme.dim(),
                ),
            ])
        })
        .collect();
    frame.render_widget(Paragraph::new(Text::from(lines)), inner);
}

fn draw_input(app: &CrewCode, frame: &mut Frame<'_>, area: Rect, permission_open: bool) {
    let theme = &app.theme;
    let border = if permission_open || app.question.is_some() {
        theme.warn
    } else if app.busy {
        theme.muted
    } else {
        app.agent_color()
    };
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::new().fg(border));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    let [glyph, field] = Layout::row()
        .constraints([Constraint::Fixed(3), Constraint::Fill(1)])
        .split_array(inner);
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(
            " ❯",
            Style::new().fg(border).bold(),
        ))),
        glyph,
    );
    app.prompt.render(frame, field, theme);
}

/// `text` cut to `max` columns with an ellipsis when it is longer.
pub fn ellipsize(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let kept: String = text.chars().take(max.saturating_sub(1)).collect();
    format!("{kept}…")
}

/// Seconds as `12s` or `3m 05s`.
fn elapsed(seconds: u64) -> String {
    if seconds < 60 {
        format!("{seconds}s")
    } else {
        format!("{}m {:02}s", seconds / 60, seconds % 60)
    }
}

/// The row under the input: what will answer on the left, the keys that matter now on the right.
fn draw_status_row(app: &CrewCode, frame: &mut Frame<'_>, area: Rect, sidebar_visible: bool) {
    let theme = &app.theme;
    let width = area.width as usize;

    if app.interrupt_armed || app.quit_armed {
        let text = if app.interrupt_armed {
            " esc again to stop · a queued message runs next"
        } else {
            " ctrl+c again to quit · the run continues on the server"
        };
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                ellipsize(text, width),
                Style::new().fg(theme.warn).bold(),
            ))),
            area,
        );
        return;
    }

    // Left: who answers, or what the agent is doing now.
    let agent = app.choice.agent.clone();
    let mut left: Vec<Span<'static>> = vec![Span::raw(" ")];
    if app.busy {
        left.push(Span::styled(
            format!("{} ", app.spinner.frame()),
            Style::new().fg(theme.warn),
        ));
    }
    if let Some(agent) = &agent {
        left.push(Span::styled(
            agent.clone(),
            Style::new().fg(app.agent_color()).bold(),
        ));
        left.push(Span::styled(" · ", theme.dim()));
    }
    if app.busy {
        let doing = app
            .transcript
            .active_tool()
            .unwrap_or_else(|| "working".to_owned());
        left.push(Span::styled(ellipsize(&doing, 40), theme.plain()));
        if let Some(since) = app.busy_since {
            left.push(Span::styled(
                format!(" · {}", elapsed(since.elapsed().as_secs())),
                theme.dim(),
            ));
        }
    } else if let Some((model, provider)) = app.model_label() {
        left.push(Span::styled(model, theme.plain()));
        match app.permission_mode.as_str() {
            "manual" => {}
            mode => left.push(Span::styled(
                format!(" · {mode}"),
                Style::new().fg(if mode == "unguarded" {
                    theme.error
                } else {
                    theme.warn
                }),
            )),
        }
        if let Some(variant) = &app.choice.variant {
            left.push(Span::styled(
                format!(" · {variant}"),
                Style::new().fg(theme.keyword),
            ));
        }
        if !provider.is_empty() && width >= 70 {
            left.push(Span::styled(format!(" · {provider}"), theme.dim()));
        }
    }
    let left_width: usize = left.iter().map(|s| s.content.chars().count()).sum();

    // Right: context use, then as many hints as fit, the most important first.
    let mut right: Vec<(String, Style)> = Vec::new();
    if !sidebar_visible {
        if let Some(usage) = app.context_usage() {
            right.push((
                format!("ctx {}%   ", (usage * 100.0).round() as u32),
                theme.dim(),
            ));
        }
    }
    let hints: &[(&str, &str)] = if app.permission.is_some() {
        &[("y", "allow once"), ("n", "reject"), ("a", "always")]
    } else if app.dialog.is_some() || app.question.is_some() {
        &[("enter", "select"), ("esc", "close"), ("↑↓", "move")]
    } else if app.busy {
        &[
            ("esc esc", "stop"),
            ("enter", "queue"),
            ("ctrl+p", "palette"),
            ("pgup/pgdn", "scroll"),
        ]
    } else {
        &[
            ("enter", "send"),
            ("ctrl+p", "palette"),
            ("tab", "agent"),
            ("ctrl+s", "model"),
            ("ctrl+k", "connect"),
            ("/", "skills"),
            ("@", "files"),
            ("ctrl+c", "quit"),
        ]
    };
    let ctx_width: usize = right.iter().map(|(t, _)| t.chars().count()).sum();
    let mut room = width.saturating_sub(left_width + ctx_width + 3);
    for (key, action) in hints {
        let needed = key.chars().count() + action.chars().count() + 4;
        if needed > room {
            break;
        }
        room -= needed;
        right.push(((*key).to_owned(), theme.key()));
        right.push((format!(" {action}   "), theme.dim()));
    }
    let right_spans: Vec<Span<'static>> = right
        .into_iter()
        .map(|(text, style)| Span::styled(text, style))
        .collect();
    let right_width: usize = right_spans.iter().map(|s| s.content.chars().count()).sum();

    frame.render_widget(Paragraph::new(Line::from(left)), area);
    if right_width > 0 {
        let at = Rect::new(
            area.x + area.width.saturating_sub(right_width as u16),
            area.y,
            right_width as u16,
            1,
        );
        frame.render_widget(Paragraph::new(Line::from(right_spans)), at);
    }
}

fn draw_overlays(app: &CrewCode, frame: &mut Frame<'_>, area: Rect, body: Rect) {
    let theme = &app.theme;
    match &app.dialog {
        Some(Dialog::Connect(connect)) => connect.render(frame, body, theme),
        Some(Dialog::Mcp(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Skills(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Variants(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Stash(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Subagents(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Palette(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Sessions(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Models(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Agents(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Themes(picker)) => picker.render(frame, body, theme),
        Some(Dialog::Rename(dialog)) => dialog.render(frame, body, theme),
        Some(Dialog::ConfirmDelete) => {
            crate::dialogs::draw_confirm(frame, body, "Delete this session?", theme)
        }
        None => {}
    }
    if let Some(question) = &app.question {
        question.render(frame, body, theme);
    }
    if let Some(permission) = &app.permission {
        permission.render(frame, body, theme);
    }
    if let Some(toast) = &app.toast {
        let width = (toast.text.chars().count() as u16 + 4).min(area.width);
        let at = Rect::new(area.x + area.width - width, area.y + 2, width, 3);
        frame.render_widget(Clear, at);
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                format!(" {}", toast.text),
                theme.plain(),
            )))
            .block(
                Block::bordered()
                    .border_type(BorderType::Rounded)
                    .border_style(Style::new().fg(toast.color)),
            ),
            at,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(spans: &[Span<'static>]) -> String {
        spans.iter().map(|s| s.content.as_ref()).collect()
    }

    #[test]
    fn the_meter_fills_in_eighths_and_keeps_its_width() {
        let theme = Theme::default();
        assert_eq!(text(&meter(0.0, 10, &theme)), "░░░░░░░░░░");
        assert_eq!(text(&meter(1.0, 10, &theme)), "██████████");
        assert_eq!(text(&meter(0.25, 10, &theme)), "██▌░░░░░░░");
        assert_eq!(text(&meter(0.5, 10, &theme)).chars().count(), 10);
    }

    #[test]
    fn the_meter_turns_from_green_to_yellow_to_red() {
        let theme = Theme::default();
        let color = |usage| meter(usage, 10, &theme)[0].style.fg;
        assert_eq!(color(0.3), Some(theme.ok));
        assert_eq!(color(0.7), Some(theme.warn));
        assert_eq!(color(0.9), Some(theme.error));
    }
}
