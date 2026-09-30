//! What the interface remembers between runs: theme, model, agent and the
//! prompts that were sent.

use std::fs;
use std::io;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const HISTORY_LIMIT: usize = 200;
const RECENT_MODELS: usize = 5;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Store {
    #[serde(default)]
    pub theme: Option<String>,
    /// `dark` or `light`: which variant of the themes to use.
    #[serde(default)]
    pub theme_mode: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub agent: Option<String>,
    #[serde(default)]
    pub history: Vec<String>,
    /// Messages set aside to be finished later, newest last.
    #[serde(default)]
    pub stash: Vec<String>,
    /// Models picked before, newest first, as `provider/model`.
    #[serde(default)]
    pub recent_models: Vec<String>,
    /// Where this state is saved; unset for a state that only lives in memory.
    #[serde(skip)]
    location: Option<PathBuf>,
}

fn path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(base.join("crewcode").join("interface-state.json"))
}

impl Store {
    /// The saved state, or an empty one when there is none or it cannot be read.
    pub fn load() -> Self {
        let location = path();
        let loaded: Store = location
            .as_ref()
            .and_then(|path| fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();
        Self { location, ..loaded }
    }

    /// Writes the state to disk; does nothing for a state that was not loaded from there.
    pub fn save(&self) -> io::Result<()> {
        let Some(path) = &self.location else {
            return Ok(());
        };
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(
            path,
            serde_json::to_string_pretty(self).map_err(io::Error::other)?,
        )
    }

    /// Sets a message aside.
    pub fn push_stash(&mut self, text: &str) {
        self.stash.push(text.to_owned());
    }

    /// Takes a message out of the stash.
    pub fn pop_stash(&mut self, index: usize) -> Option<String> {
        (index < self.stash.len()).then(|| self.stash.remove(index))
    }

    /// Remembers a picked model, newest first.
    pub fn remember_model(&mut self, model: &str) {
        self.recent_models.retain(|earlier| earlier != model);
        self.recent_models.insert(0, model.to_owned());
        self.recent_models.truncate(RECENT_MODELS);
    }

    /// Remembers a sent prompt, dropping an earlier identical one and the oldest past the limit.
    pub fn remember_prompt(&mut self, prompt: &str) {
        self.history.retain(|earlier| earlier != prompt);
        self.history.push(prompt.to_owned());
        let excess = self.history.len().saturating_sub(HISTORY_LIMIT);
        self.history.drain(..excess);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_prompts_move_to_the_end() {
        let mut store = Store::default();
        ["a", "b", "a"]
            .iter()
            .for_each(|p| store.remember_prompt(p));
        assert_eq!(store.history, ["b", "a"]);
    }

    #[test]
    fn recent_models_keep_the_newest_first_without_repeats() {
        let mut store = Store::default();
        ["a/1", "b/2", "a/1"]
            .iter()
            .for_each(|m| store.remember_model(m));
        assert_eq!(store.recent_models, ["a/1", "b/2"]);
        (0..10).for_each(|n| store.remember_model(&format!("p/{n}")));
        assert_eq!(store.recent_models.len(), RECENT_MODELS);
    }

    #[test]
    fn the_stash_gives_back_what_was_set_aside() {
        let mut store = Store::default();
        store.push_stash("one");
        store.push_stash("two");
        assert_eq!(store.pop_stash(0).as_deref(), Some("one"));
        assert_eq!(store.stash, ["two"]);
        assert_eq!(store.pop_stash(5), None);
    }

    #[test]
    fn history_is_capped() {
        let mut store = Store::default();
        (0..HISTORY_LIMIT + 5).for_each(|n| store.remember_prompt(&n.to_string()));
        assert_eq!(store.history.len(), HISTORY_LIMIT);
        assert_eq!(store.history[0], "5");
    }
}
