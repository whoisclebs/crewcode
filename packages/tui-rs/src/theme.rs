//! Color themes, and how each element of the interface is styled with them.

use crewtui::{Color, Style};
use crewtui_rich::{DiffStyles, HighlightStyles, MarkdownStyles};

/// The colors of one theme. `Color::Default` keeps the terminal's own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Theme {
    pub name: &'static str,
    pub accent: Color,
    pub user: Color,
    pub ok: Color,
    pub warn: Color,
    pub error: Color,
    pub muted: Color,
    pub text: Color,
    /// A subtle fill behind the user's messages; `Color::Default` for none.
    pub panel: Color,
    /// The color of the whole screen, drawn only when `paints` is set.
    pub background: Color,
    /// True when the theme needs its own background to be readable, as light themes do on a dark terminal.
    pub paints: bool,
    pub keyword: Color,
    pub string: Color,
    pub number: Color,
    pub heading: Color,
}

const fn rgb(hex: u32) -> Color {
    Color::Rgb((hex >> 16) as u8, (hex >> 8) as u8, hex as u8)
}

/// Every theme, the first one being the default.
pub const THEMES: [Theme; 8] = [
    Theme {
        name: "terminal",
        accent: Color::Cyan,
        user: Color::Green,
        ok: Color::Green,
        warn: Color::Yellow,
        error: Color::Red,
        muted: Color::Default,
        text: Color::Default,
        panel: Color::Default,
        background: Color::Default,
        paints: false,
        keyword: Color::Magenta,
        string: Color::Green,
        number: Color::Yellow,
        heading: Color::Blue,
    },
    Theme {
        name: "tokyonight",
        accent: rgb(0x7aa2f7),
        user: rgb(0x9ece6a),
        ok: rgb(0x9ece6a),
        warn: rgb(0xe0af68),
        error: rgb(0xf7768e),
        muted: rgb(0x7d84a5),
        text: rgb(0xc0caf5),
        panel: rgb(0x1f2335),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xbb9af7),
        string: rgb(0x9ece6a),
        number: rgb(0xff9e64),
        heading: rgb(0x7dcfff),
    },
    Theme {
        name: "catppuccin",
        accent: rgb(0x89b4fa),
        user: rgb(0xa6e3a1),
        ok: rgb(0xa6e3a1),
        warn: rgb(0xf9e2af),
        error: rgb(0xf38ba8),
        muted: rgb(0x868a9c),
        text: rgb(0xcdd6f4),
        panel: rgb(0x313244),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xcba6f7),
        string: rgb(0xa6e3a1),
        number: rgb(0xfab387),
        heading: rgb(0x94e2d5),
    },
    Theme {
        name: "gruvbox",
        accent: rgb(0x83a598),
        user: rgb(0xb8bb26),
        ok: rgb(0xb8bb26),
        warn: rgb(0xfabd2f),
        error: rgb(0xfb4934),
        muted: rgb(0xa09285),
        text: rgb(0xebdbb2),
        panel: rgb(0x3c3836),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xd3869b),
        string: rgb(0xb8bb26),
        number: rgb(0xfe8019),
        heading: rgb(0x8ec07c),
    },
    Theme {
        name: "nord",
        accent: rgb(0x88c0d0),
        user: rgb(0xa3be8c),
        ok: rgb(0xa3be8c),
        warn: rgb(0xebcb8b),
        error: rgb(0xbf616a),
        muted: rgb(0x949eb0),
        text: rgb(0xd8dee9),
        panel: rgb(0x3b4252),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xb48ead),
        string: rgb(0xa3be8c),
        number: rgb(0xd08770),
        heading: rgb(0x81a1c1),
    },
    Theme {
        name: "rosepine",
        accent: rgb(0xc4a7e7),
        user: rgb(0x9ccfd8),
        ok: rgb(0x3e8fb0),
        warn: rgb(0xf6c177),
        error: rgb(0xeb6f92),
        muted: rgb(0x88849c),
        text: rgb(0xe0def4),
        panel: rgb(0x26233a),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xebbcba),
        string: rgb(0xf6c177),
        number: rgb(0xebbcba),
        heading: rgb(0xebbcba),
    },
    Theme {
        name: "dracula",
        accent: rgb(0xbd93f9),
        user: rgb(0x50fa7b),
        ok: rgb(0x50fa7b),
        warn: rgb(0xf1fa8c),
        error: rgb(0xff5555),
        muted: rgb(0x8692ba),
        text: rgb(0xf8f8f2),
        panel: rgb(0x343746),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xff79c6),
        string: rgb(0xf1fa8c),
        number: rgb(0xffb86c),
        heading: rgb(0x8be9fd),
    },
    Theme {
        name: "onedark",
        accent: rgb(0x61afef),
        user: rgb(0x98c379),
        ok: rgb(0x98c379),
        warn: rgb(0xe5c07b),
        error: rgb(0xe06c75),
        muted: rgb(0x9296a0),
        text: rgb(0xabb2bf),
        panel: rgb(0x2c313c),
        background: Color::Default,
        paints: false,
        keyword: rgb(0xc678dd),
        string: rgb(0x98c379),
        number: rgb(0xd19a66),
        heading: rgb(0x56b6c2),
    },
];

impl Default for Theme {
    fn default() -> Self {
        THEMES[0]
    }
}

impl Theme {
    /// Ordinary text.
    pub fn plain(&self) -> Style {
        Style::new().fg(self.text)
    }

    /// Secondary text: hints, tool output, timestamps.
    pub fn dim(&self) -> Style {
        if self.muted == Color::Default {
            Style::new().dim()
        } else {
            Style::new().fg(self.muted)
        }
    }

    /// The color of the agent at `index` in the list of agents, so each one looks different.
    pub fn agent_color(&self, index: usize) -> Color {
        [self.accent, self.keyword, self.warn, self.ok, self.heading][index % 5]
    }

    /// A key name in a hint, such as `enter`.
    pub fn key(&self) -> Style {
        Style::new().fg(self.text).bold()
    }

    /// The colors of rendered Markdown.
    pub fn markdown(&self) -> MarkdownStyles {
        let mut styles = MarkdownStyles::default();
        styles.heading = [
            Style::new().fg(self.heading).bold().underline(),
            Style::new().fg(self.heading).bold(),
            Style::new().fg(self.accent).bold(),
            Style::new().fg(self.text).bold(),
            Style::new().fg(self.text).bold(),
            Style::new().fg(self.muted).bold(),
        ];
        styles.code = Style::new().fg(self.warn);
        if self.panel != Color::Default {
            styles.code_block = Style::new().bg(self.panel);
        }
        styles.link = Style::new().fg(self.accent).underline();
        styles.quote = self.dim();
        styles.rule = self.dim();
        styles.bullet = Style::new().fg(self.accent);
        styles
    }

    /// The colors of highlighted code.
    pub fn code(&self) -> HighlightStyles {
        let mut styles = HighlightStyles::default();
        styles.plain = self.plain();
        styles.keyword = Style::new().fg(self.keyword).bold();
        styles.string = Style::new().fg(self.string);
        styles.comment = self.dim().italic();
        styles.number = Style::new().fg(self.number);
        styles.gutter = self.dim();
        styles
    }

    /// The colors of a diff.
    pub fn diff(&self) -> DiffStyles {
        let mut styles = DiffStyles::default();
        styles.added = Style::new().fg(self.ok);
        styles.removed = Style::new().fg(self.error);
        styles.hunk = Style::new().fg(self.accent);
        styles.header = self.dim().bold();
        styles.context = self.dim();
        styles.gutter = self.dim();
        styles
    }
}

/// How long ago a millisecond timestamp was, in a few characters.
pub fn ago(timestamp_ms: u64) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64);
    ago_between(timestamp_ms, now)
}

fn ago_between(timestamp_ms: u64, now_ms: u64) -> String {
    let seconds = now_ms.saturating_sub(timestamp_ms) / 1000;
    match seconds {
        0..60 => "now".to_owned(),
        60..3600 => format!("{}m ago", seconds / 60),
        3600..86_400 => format!("{}h ago", seconds / 3600),
        _ => format!("{}d ago", seconds / 86_400),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn themes_are_found_by_name_and_names_are_unique() {
        let mut names: Vec<_> = THEMES.iter().map(|t| t.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), THEMES.len());
    }

    #[test]
    fn every_theme_has_readable_secondary_text() {
        // Themes that paint nothing keep the terminal's own color and dim it; the rest must contrast with a dark background.
        let dark_backgrounds = [
            0x1a1b26, 0x1e1e2e, 0x282828, 0x2e3440, 0x191724, 0x282a36, 0x282c34,
        ];
        let luminance = |hex: u32| {
            let channel = |c: u32| {
                let v = f64::from(c & 255) / 255.0;
                if v <= 0.03928 {
                    v / 12.92
                } else {
                    ((v + 0.055) / 1.055).powf(2.4)
                }
            };
            0.2126 * channel(hex >> 16) + 0.7152 * channel(hex >> 8) + 0.0722 * channel(hex)
        };
        for (theme, background) in THEMES[1..].iter().zip(dark_backgrounds) {
            let Color::Rgb(r, g, b) = theme.muted else {
                panic!("{} should use RGB", theme.name)
            };
            let foreground = luminance(u32::from(r) << 16 | u32::from(g) << 8 | u32::from(b));
            let ratio = (foreground + 0.05) / (luminance(background) + 0.05);
            assert!(
                ratio >= 4.5,
                "{} muted text has contrast {ratio:.2}",
                theme.name
            );
        }
    }

    #[test]
    fn ago_picks_the_largest_unit() {
        assert_eq!(ago_between(0, 30_000), "now");
        assert_eq!(ago_between(0, 5 * 60_000), "5m ago");
        assert_eq!(ago_between(0, 3 * 3_600_000), "3h ago");
        assert_eq!(ago_between(0, 2 * 86_400_000), "2d ago");
    }
}
