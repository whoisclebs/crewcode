//! Themes written as JSON: the ones that ship with CrewCode and the ones users add.
//!
//! A theme file has `defs`, a table of named colors, and `theme`, which gives each role a color: a `#rrggbb`
//! value, the name of a def, or `{ "dark": ..., "light": ... }` to differ by mode. Users put their own files in
//! `themes/*.json` under the CrewCode config directory or `.crewcode/` in the project.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use crewtui::Color;
use serde_json::Value;

use crate::builtin_themes::BUILTIN;
use crate::theme::{THEMES, Theme};

/// Which variant of a theme to use.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Dark,
    Light,
}

impl Mode {
    pub fn name(self) -> &'static str {
        match self {
            Mode::Dark => "dark",
            Mode::Light => "light",
        }
    }

    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "dark" => Some(Mode::Dark),
            "light" => Some(Mode::Light),
            _ => None,
        }
    }

    pub fn other(self) -> Self {
        match self {
            Mode::Dark => Mode::Light,
            Mode::Light => Mode::Dark,
        }
    }
}

/// `#rgb` or `#rrggbb` as a color; a fourth channel of alpha is ignored.
fn parse_hex(text: &str) -> Option<Color> {
    let digits = text.strip_prefix('#')?;
    let byte = |pair: &str| u8::from_str_radix(pair, 16).ok();
    match digits.len() {
        3 => {
            let expand = |i: usize| byte(&digits[i..=i].repeat(2));
            Some(Color::Rgb(expand(0)?, expand(1)?, expand(2)?))
        }
        6 | 8 => Some(Color::Rgb(
            byte(&digits[0..2])?,
            byte(&digits[2..4])?,
            byte(&digits[4..6])?,
        )),
        _ => None,
    }
}

/// The color a value stands for in `mode`, following references to `defs`.
fn resolve(value: &Value, defs: &Value, mode: Mode, depth: u8) -> Option<Color> {
    if depth > 8 {
        return None;
    }
    match value {
        Value::String(text) if text == "none" || text == "transparent" => None,
        Value::String(text) => {
            parse_hex(text).or_else(|| resolve(defs.get(text)?, defs, mode, depth + 1))
        }
        Value::Object(_) => resolve(value.get(mode.name())?, defs, mode, depth + 1),
        _ => None,
    }
}

/// A theme from its JSON, or `None` when it lacks the two colors nothing works without.
pub fn parse(name: &str, json: &Value, mode: Mode) -> Option<Theme> {
    let (defs, roles) = (&json["defs"], json.get("theme")?);
    let color = |role: &str| {
        roles
            .get(role)
            .and_then(|value| resolve(value, defs, mode, 0))
    };
    let base = Theme::default();
    let accent = color("primary")?;
    let text = color("text")?;
    let success = color("success").unwrap_or(base.ok);
    Some(Theme {
        name: Box::leak(name.to_owned().into_boxed_str()),
        accent,
        user: success,
        ok: success,
        warn: color("warning").unwrap_or(base.warn),
        error: color("error").unwrap_or(base.error),
        muted: color("textMuted").unwrap_or(base.muted),
        text,
        panel: color("backgroundPanel").unwrap_or(Color::Default),
        background: color("background").unwrap_or(Color::Default),
        // A light theme on a dark terminal is unreadable unless it brings its own background.
        paints: mode == Mode::Light,
        keyword: color("syntaxKeyword")
            .or_else(|| color("secondary"))
            .unwrap_or(base.keyword),
        string: color("syntaxString").unwrap_or(success),
        number: color("syntaxNumber")
            .or_else(|| color("warning"))
            .unwrap_or(base.number),
        heading: color("markdownHeading").unwrap_or(accent),
    })
}

/// Where users keep their own themes.
fn custom_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| home.map(|h| h.join(".config")));
    let mut dirs: Vec<PathBuf> = config
        .iter()
        .map(|c| c.join("crewcode").join("themes"))
        .collect();
    if let Ok(project) = std::env::current_dir() {
        dirs.push(project.join(".crewcode").join("themes"));
    }
    dirs
}

/// Every theme in `directory`, named after its file.
fn read_dir(directory: &Path, mode: Mode) -> Vec<Theme> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    files.sort();
    files
        .iter()
        .filter_map(|path| {
            let json: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
            parse(path.file_stem()?.to_str()?, &json, mode)
        })
        .collect()
}

/// The built-in themes plus the user's, the terminal's own first and the rest by name. A user's theme replaces a built-in one of the same name.
fn collect(mode: Mode, custom: &[PathBuf]) -> Vec<Theme> {
    let mut themes: Vec<Theme> = Vec::new();
    let mut add = |theme: Theme| {
        themes.retain(|existing| existing.name != theme.name);
        themes.push(theme);
    };
    // The JSON versions cover both modes; the hand-tuned dark ones are kept for the names they share.
    BUILTIN
        .iter()
        .filter_map(|(name, text)| parse(name, &serde_json::from_str(text).ok()?, mode))
        .for_each(&mut add);
    if mode == Mode::Dark {
        THEMES[1..].iter().copied().for_each(&mut add);
    }
    custom
        .iter()
        .flat_map(|dir| read_dir(dir, mode))
        .for_each(&mut add);
    themes.sort_by_key(|t| t.name.to_lowercase());
    if mode == Mode::Dark {
        themes.insert(0, THEMES[0]);
    }
    themes
}

/// Every theme available in `mode`.
pub fn all(mode: Mode) -> &'static [Theme] {
    static REGISTRY: OnceLock<[Vec<Theme>; 2]> = OnceLock::new();
    let custom = custom_dirs();
    let registry =
        REGISTRY.get_or_init(|| [collect(Mode::Dark, &custom), collect(Mode::Light, &custom)]);
    &registry[usize::from(mode == Mode::Light)]
}

/// The theme called `name` in `mode`.
pub fn find(name: &str, mode: Mode) -> Option<Theme> {
    all(mode).iter().copied().find(|theme| theme.name == name)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn hex_colors_come_in_three_six_and_eight_digits() {
        assert_eq!(parse_hex("#fff"), Some(Color::Rgb(255, 255, 255)));
        assert_eq!(parse_hex("#1a1b26"), Some(Color::Rgb(0x1a, 0x1b, 0x26)));
        assert_eq!(parse_hex("#1a1b26cc"), Some(Color::Rgb(0x1a, 0x1b, 0x26)));
        assert_eq!(parse_hex("1a1b26"), None);
        assert_eq!(parse_hex("#12"), None);
        assert_eq!(parse_hex("#gggggg"), None);
    }

    #[test]
    fn colors_follow_defs_and_pick_the_variant_of_the_mode() {
        let defs = json!({"ink": "#101010", "paper": "#f0f0f0", "alias": "ink", "loop": "loop"});
        let role = json!({"dark": "paper", "light": "alias"});
        assert_eq!(
            resolve(&role, &defs, Mode::Dark, 0),
            Some(Color::Rgb(0xf0, 0xf0, 0xf0))
        );
        assert_eq!(
            resolve(&role, &defs, Mode::Light, 0),
            Some(Color::Rgb(0x10, 0x10, 0x10))
        );
        assert_eq!(
            resolve(&json!("loop"), &defs, Mode::Dark, 0),
            None,
            "a reference cycle ends"
        );
        assert_eq!(resolve(&json!("none"), &defs, Mode::Dark, 0), None);
        assert_eq!(resolve(&json!("missing"), &defs, Mode::Dark, 0), None);
    }

    #[test]
    fn a_theme_maps_its_roles_and_falls_back_for_the_ones_it_omits() {
        let json = json!({"defs": {"blue": "#0000ff"}, "theme": {"primary": "blue", "text": "#eeeeee", "success": "#00ff00"}});
        let theme = parse("mine", &json, Mode::Dark).unwrap();
        assert_eq!(
            (theme.name, theme.accent, theme.text, theme.ok),
            (
                "mine",
                Color::Rgb(0, 0, 255),
                Color::Rgb(0xee, 0xee, 0xee),
                Color::Rgb(0, 255, 0)
            )
        );
        assert_eq!(
            theme.error,
            Theme::default().error,
            "an omitted role uses the default"
        );
        assert!(!theme.paints);
        assert!(
            parse("mine", &json, Mode::Light).unwrap().paints,
            "a light theme brings its own background"
        );
    }

    #[test]
    fn a_theme_without_its_essential_colors_is_refused() {
        assert!(parse("bad", &json!({"theme": {"text": "#fff"}}), Mode::Dark).is_none());
        assert!(parse("bad", &json!({"defs": {}}), Mode::Dark).is_none());
    }

    #[test]
    fn every_built_in_theme_parses_in_both_modes() {
        for (name, text) in BUILTIN {
            let json: Value = serde_json::from_str(text).unwrap_or_else(|e| panic!("{name}: {e}"));
            for mode in [Mode::Dark, Mode::Light] {
                assert!(parse(name, &json, mode).is_some(), "{name} in {mode:?}");
            }
        }
    }

    #[test]
    fn the_registry_starts_with_the_terminal_theme_and_has_no_repeated_names() {
        let themes = all(Mode::Dark);
        assert_eq!(themes[0].name, "terminal");
        assert!(themes.len() > 30);
        let mut names: Vec<_> = themes.iter().map(|t| t.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), themes.len());
        assert!(find("crewcode", Mode::Dark).is_some() && find("crewcode", Mode::Light).is_some());
    }

    #[test]
    fn a_users_theme_file_is_found_and_replaces_a_built_in_of_the_same_name() {
        let directory =
            std::env::temp_dir().join(format!("crewcode-themes-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(
            directory.join("mine.json"),
            r##"{"theme": {"primary": "#ff0000", "text": "#ffffff"}}"##,
        )
        .unwrap();
        std::fs::write(
            directory.join("nord.json"),
            r##"{"theme": {"primary": "#00ff00", "text": "#ffffff"}}"##,
        )
        .unwrap();
        std::fs::write(directory.join("broken.json"), "not json").unwrap();
        let themes = collect(Mode::Dark, std::slice::from_ref(&directory));
        assert_eq!(
            themes.iter().find(|t| t.name == "mine").map(|t| t.accent),
            Some(Color::Rgb(255, 0, 0))
        );
        assert_eq!(
            themes.iter().find(|t| t.name == "nord").map(|t| t.accent),
            Some(Color::Rgb(0, 255, 0))
        );
        assert!(themes.iter().all(|t| t.name != "broken"));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
