//! The application state and how it reacts to keys and server events.

use std::time::{Duration, Instant};

use crewtui::widgets::Spinner;
use crewtui::{
    App, Cmd, Color, Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseKind, Style,
};

use crate::cli::Start;
use crate::client::{
    AgentChoice, AuthMethod, Authorization, Choice, Client, CommandChoice, GlobalEvent,
    ModelChoice, ModelSelection, Outgoing, ProviderInfo, Session, StoredMessage, Todo,
};
use crate::connect::{Connect, Effect, Provider};
use crate::dialogs::{Permission, Question, QuestionOutcome, TextDialog, TextOutcome};
use crate::picker::{Entry, Outcome, Picker};
use crate::prompt::Prompt;
use crate::store::Store;
use crate::theme::Theme;
use crate::themes::{self, Mode};
use crate::transcript::Transcript;

const SPIN_EVERY: Duration = Duration::from_millis(90);
const TOAST_FOR: Duration = Duration::from_secs(4);
const PERMISSION_MODES: [&str; 3] = ["manual", "auto", "observe"];

pub enum Msg {
    Key(KeyEvent),
    Paste(String),
    Scroll(i32),
    Spin,
    ToastExpired(u64),
    /// The one-second window in which a second Esc or Ctrl+C confirms has passed.
    ArmExpired(u64),
    FilesFound(String, Result<Vec<String>, String>),
    ConnectLoaded(Result<ConnectData, String>),
    /// The session the command line asked to open, if any.
    StartResolved(Result<Option<(String, String)>, String>),
    Authorized(Provider, usize, Result<Authorization, String>),
    /// A credential was stored, or a login finished.
    ConnectSaved(Provider, Result<(), String>),
    /// The models after connecting a provider, to offer that provider's first.
    ConnectedModels(String, Result<(Vec<ModelChoice>, Option<String>), String>),
    CtrlC,
    Server(GlobalEvent),
    StreamEnded(String),
    Connected(Result<(), String>),
    ModelsLoaded(Result<(Vec<ModelChoice>, Option<String>), String>),
    AgentsLoaded(Result<Vec<AgentChoice>, String>),
    CommandsLoaded(Result<Vec<CommandChoice>, String>),
    ModeLoaded(Result<String, String>),
    InfoLoaded(Option<String>, Result<Vec<(String, String)>, String>),
    Created(Result<String, String>, String),
    Sent(Result<(), String>),
    SessionsLoaded(Result<Vec<Session>, String>),
    Loaded {
        id: String,
        title: String,
        parent: Option<(String, String)>,
        messages: Result<Vec<StoredMessage>, String>,
    },
    McpToggled(String, Result<Vec<(String, String)>, String>),
    ChildrenLoaded(Result<Vec<Session>, String>),
    TodosLoaded(String, Result<Vec<Todo>, String>),
    Deleted(Result<(), String>),
    Forked(Result<String, String>),
    ModeChanged(Result<String, String>),
    /// The outcome of an action that has nothing to show when it works.
    Done(&'static str, Result<(), String>),
}

/// The title to show for a session: the server names a new one after its creation time until it has read the first message.
pub fn display_title(title: &str) -> String {
    if title.is_empty()
        || title.starts_with("New session - ")
        || title.starts_with("Child session - ")
    {
        "untitled".to_owned()
    } else {
        title.to_owned()
    }
}

/// How a message is sent to the server.
#[derive(Debug, PartialEq, Eq)]
pub enum Dispatch {
    /// One leading command, run by the server as it would from any client.
    Command { name: String, arguments: String },
    /// A message that may carry skill instructions and attached files along with the text.
    Message {
        instructions: Vec<String>,
        files: Vec<String>,
    },
}

/// One row of the popup that completes a `/command` or an `@file` while it is typed.
#[derive(Debug, Clone)]
pub struct Suggestion {
    /// What replaces the word being typed, such as `/review` or `@src/main.rs`.
    pub insert: String,
    /// Where it comes from: `skill`, `mcp`, or empty.
    pub tag: String,
    pub detail: String,
}

/// `text` without the `/name` words of the given commands, spaces tidied.
fn text_without_mentions(text: &str, mentioned: &[&CommandChoice]) -> String {
    text.split_whitespace()
        .filter(|word| {
            !word
                .strip_prefix('/')
                .is_some_and(|name| mentioned.iter().any(|c| c.name == name))
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// What a palette row does.
#[derive(Debug, Clone)]
pub enum Action {
    NewSession,
    Sessions,
    Models,
    Agents,
    Themes,
    ThemeMode,
    PermissionMode,
    Rename,
    Delete,
    Fork,
    Compact,
    CopyAnswer,
    ToggleSidebar,
    Quit,
    Connect,
    Skills,
    Mcp,
    Variants,
    StashPrompt,
    RestoreStash,
    Subagents,
    ParentSession,
    Command(String),
}

/// A session picked from the list: its id, its title, and its parent's id and title when it is a subagent's.
pub type SessionChoice = (String, String, Option<(String, String)>);

/// What the connect-a-provider dialog needs to open: the providers and how each can be signed in to.
pub type ConnectData = (
    Vec<ProviderInfo>,
    std::collections::HashMap<String, Vec<AuthMethod>>,
);

pub enum Dialog {
    Mcp(Picker<String>),
    Skills(Picker<String>),
    Variants(Picker<Option<String>>),
    Stash(Picker<usize>),
    Subagents(Picker<(String, String)>),
    Connect(Box<Connect>),
    Palette(Picker<Action>),
    Sessions(Picker<SessionChoice>),
    Models(Picker<ModelSelection>),
    Agents(Picker<String>),
    Themes(Picker<&'static str>),
    Rename(TextDialog),
    ConfirmDelete,
}

pub struct Toast {
    pub text: String,
    pub color: Color,
    id: u64,
}

pub struct CrewCode {
    pub client: Client,
    pub store: Store,
    pub theme: Theme,
    pub theme_mode: Mode,
    pub transcript: Transcript,
    pub prompt: Prompt,
    pub session: Option<String>,
    pub session_title: String,
    /// The session that started this one, when this is a subagent's: its id and title.
    pub parent_session: Option<(String, String)>,
    pub busy: bool,
    /// When the current run started, for the elapsed time in the status row.
    pub busy_since: Option<Instant>,
    pub spinner: Spinner,
    pub dialog: Option<Dialog>,
    pub permission: Option<Permission>,
    pub question: Option<Question>,
    pub toast: Option<Toast>,
    /// Set after one Esc while busy: the next Esc interrupts the run.
    pub interrupt_armed: bool,
    /// Set after one Ctrl+C while busy: the next one quits.
    pub quit_armed: bool,
    arm_count: u64,
    pub sidebar: bool,
    pub todos: Vec<Todo>,
    pub choice: Choice,
    pub default_model: Option<String>,
    pub models: Vec<ModelChoice>,
    pub agents: Vec<AgentChoice>,
    pub commands: Vec<CommandChoice>,
    pub permission_mode: String,
    pub branch: Option<String>,
    /// Which slash-command suggestion is highlighted while the prompt starts with `/`.
    pub suggestion: usize,
    suggestions_dismissed: bool,
    /// The connect dialog opens by itself once when nothing is connected.
    connect_offered: bool,
    /// What the command line asked for when starting.
    start: Start,
    /// A message to send once the session it belongs to is open.
    pending_prompt: Option<String>,
    /// The theme to return to when the theme picker is closed without choosing.
    theme_before: Option<Theme>,
    /// Project files matching the `@word` being typed.
    file_matches: Vec<String>,
    pub mcp: Vec<(String, String)>,
    toast_count: u64,
}

impl CrewCode {
    pub fn new(client: Client, store: Store) -> Self {
        let theme_mode = store
            .theme_mode
            .as_deref()
            .and_then(Mode::parse)
            .unwrap_or(Mode::Dark);
        let theme = store
            .theme
            .as_deref()
            .and_then(|name| themes::find(name, theme_mode))
            .unwrap_or_default();
        let transcript = Transcript::new(theme, &client.raw_directory());
        let choice = Choice {
            model: store.model.as_deref().and_then(ModelSelection::parse),
            agent: store.agent.clone(),
            variant: None,
        };
        Self {
            client,
            theme,
            theme_mode,
            transcript,
            prompt: Prompt::new(store.history.clone()),
            store,
            session: None,
            session_title: String::new(),
            parent_session: None,
            busy: false,
            busy_since: None,
            theme_before: None,
            file_matches: Vec::new(),
            spinner: Spinner::dots().style(Style::new().fg(theme.warn)),
            dialog: None,
            permission: None,
            question: None,
            toast: None,
            interrupt_armed: false,
            quit_armed: false,
            arm_count: 0,
            sidebar: true,
            todos: Vec::new(),
            choice,
            default_model: None,
            models: Vec::new(),
            agents: Vec::new(),
            commands: Vec::new(),
            permission_mode: "manual".to_owned(),
            branch: None,
            suggestion: 0,
            suggestions_dismissed: false,
            connect_offered: false,
            start: Start::default(),
            pending_prompt: None,
            mcp: Vec::new(),
            toast_count: 0,
        }
    }

    /// Applies the command line: the model and agent for the first messages, and what to open on start.
    pub fn with_start(mut self, start: Start) -> Self {
        if let Some(model) = start.model.as_deref().and_then(ModelSelection::parse) {
            self.choice.model = Some(model);
        }
        if let Some(agent) = &start.agent {
            self.choice.agent = Some(agent.clone());
        }
        self.pending_prompt = start.prompt.clone();
        self.start = start;
        self
    }

    /// Finds the session the command line asked for, copying it when `--fork` was given.
    fn resolve_start(&self) -> Cmd<Msg> {
        let (client, start) = (
            self.client.clone(),
            (
                self.start.session.clone(),
                self.start.continue_last,
                self.start.fork,
            ),
        );
        Cmd::perform(move || {
            let (session, continue_last, fork) = start;
            let found = match (session, continue_last) {
                (Some(id), _) => client.session(&id).map(Some),
                (None, true) => client.latest_session(),
                (None, false) => Ok(None),
            };
            Msg::StartResolved(found.and_then(|found| match found {
                Some(session) if fork => {
                    let copy = client.fork_session(&session.id)?;
                    Ok(Some((copy, "forked session".to_owned())))
                }
                Some(session) => Ok(Some((
                    session.id.clone(),
                    crate::app::display_title(&session.title),
                ))),
                None => Ok(None),
            }))
        })
    }

    /// The model the next prompt will use, as `provider/model`.
    pub fn active_model(&self) -> Option<String> {
        self.choice
            .model
            .as_ref()
            .map(ModelSelection::qualified)
            .or_else(|| self.default_model.clone())
    }

    /// The model that the next message goes to, as its name and provider.
    pub fn model_label(&self) -> Option<(String, String)> {
        let active = self
            .active_model()
            .or_else(|| self.transcript.model.clone())?;
        Some(
            self.models
                .iter()
                .find(|m| format!("{}/{}", m.provider_id, m.model_id) == active)
                .map_or((active.clone(), String::new()), |m| {
                    (m.name.clone(), m.provider_name.clone())
                }),
        )
    }

    /// The color that stands for the current agent.
    pub fn agent_color(&self) -> Color {
        let index = self
            .choice
            .agent
            .as_deref()
            .and_then(|name| self.agents.iter().position(|a| a.name == name));
        index.map_or(self.theme.accent, |i| self.theme.agent_color(i))
    }

    /// How much of the model's context window the conversation uses, from 0.0 to 1.0, when the limit is known.
    pub fn context_usage(&self) -> Option<f64> {
        let active = self
            .transcript
            .model
            .clone()
            .or_else(|| self.active_model())?;
        let limit = self
            .models
            .iter()
            .find(|m| format!("{}/{}", m.provider_id, m.model_id) == active)
            .map(|m| m.context_limit)
            .filter(|limit| *limit > 0)?;
        Some((self.transcript.context_tokens as f64 / limit as f64).clamp(0.0, 1.0))
    }

    fn toast(&mut self, text: impl Into<String>, color: Color) -> Cmd<Msg> {
        self.toast_count += 1;
        self.toast = Some(Toast {
            text: text.into(),
            color,
            id: self.toast_count,
        });
        Cmd::after(TOAST_FOR, Msg::ToastExpired(self.toast_count))
    }

    /// Starts the one-second window in which a repeated key confirms; returns the timer.
    fn arm(&mut self) -> Cmd<Msg> {
        self.arm_count += 1;
        Cmd::after(Duration::from_secs(1), Msg::ArmExpired(self.arm_count))
    }

    fn fail(&mut self, error: String) -> Cmd<Msg> {
        self.toast(error, self.theme.error)
    }

    fn save(&mut self) -> Cmd<Msg> {
        self.store.theme = Some(self.theme.name.to_owned());
        match self.store.save() {
            Ok(()) => Cmd::none(),
            Err(error) => self.fail(format!("cannot save settings: {error}")),
        }
    }

    fn start_working(&mut self) -> Cmd<Msg> {
        if std::mem::replace(&mut self.busy, true) {
            return Cmd::none();
        }
        self.busy_since = Some(Instant::now());
        Cmd::after(SPIN_EVERY, Msg::Spin)
    }

    fn stop_working(&mut self) {
        self.busy = false;
        self.busy_since = None;
    }

    fn apply_theme(&mut self, theme: Theme) {
        if theme == self.theme {
            return;
        }
        self.theme = theme;
        self.transcript.set_theme(theme);
        self.spinner = Spinner::dots().style(Style::new().fg(theme.warn));
    }

    fn reset_session(&mut self) {
        self.session = None;
        self.session_title.clear();
        self.parent_session = None;
        self.transcript.clear();
        self.todos.clear();
        self.stop_working();
        self.permission = None;
        self.question = None;
    }

    fn submit(&mut self, text: String) -> Cmd<Msg> {
        self.prompt.remember(&text);
        self.store.remember_prompt(&text);
        let client = self.client.clone();
        let spin = self.start_working();
        let work = match self.session.clone() {
            Some(session) => self.deliver(&session, text),
            None => Cmd::perform(move || Msg::Created(client.create_session(), text)),
        };
        Cmd::batch([work, spin, self.save()])
    }

    /// Sends `text` to `session`, as a command or as a message with its skills and files.
    fn deliver(&self, session: &str, text: String) -> Cmd<Msg> {
        let (client, choice, session) =
            (self.client.clone(), self.choice.clone(), session.to_owned());
        match self.dispatch(&text) {
            Dispatch::Command { name, arguments } => {
                Cmd::perform(move || Msg::Sent(client.run_command(&session, &name, &arguments)))
            }
            Dispatch::Message {
                instructions,
                files,
            } => {
                let message = Outgoing {
                    text,
                    hidden: instructions,
                    files,
                };
                Cmd::perform(move || Msg::Sent(client.prompt(&session, &message, &choice)))
            }
        }
    }

    /// How `text` is sent, judging by the `/commands`, skills and `@files` it mentions.
    fn dispatch(&self, text: &str) -> Dispatch {
        let mentioned = self.mentioned_commands(text);
        let files = self.mentioned_files(text);
        let leading = text.trim_start().starts_with('/');
        match mentioned.as_slice() {
            [] => Dispatch::Message {
                instructions: Vec::new(),
                files,
            },
            [only] if leading && files.is_empty() => Dispatch::Command {
                name: only.name.clone(),
                arguments: text_without_mentions(text, &mentioned),
            },
            _ => {
                let arguments = text_without_mentions(text, &mentioned);
                let instructions = mentioned
                    .iter()
                    .map(|c| {
                        format!(
                            "The user invoked /{}. Follow these instructions:\n\n{}",
                            c.name,
                            c.template.replace("$ARGUMENTS", &arguments)
                        )
                    })
                    .collect();
                Dispatch::Message {
                    instructions,
                    files,
                }
            }
        }
    }

    /// The `@path` words of `text` that name a file in the working directory, without the `@`, once each.
    fn mentioned_files(&self, text: &str) -> Vec<String> {
        let root = std::path::PathBuf::from(self.client.raw_directory());
        let mut found: Vec<String> = Vec::new();
        for path in text
            .split_whitespace()
            .filter_map(|word| word.strip_prefix('@'))
            .filter(|path| !path.is_empty())
        {
            if root.join(path).is_file() && !found.iter().any(|f| f == path) {
                found.push(path.to_owned());
            }
        }
        found
    }

    /// The known commands and skills written as `/name` anywhere in `text`, once each, in order.
    fn mentioned_commands(&self, text: &str) -> Vec<&CommandChoice> {
        let mut found: Vec<&CommandChoice> = Vec::new();
        for word in text.split_whitespace() {
            let Some(command) = word
                .strip_prefix('/')
                .and_then(|name| self.commands.iter().find(|c| c.name == name))
            else {
                continue;
            };
            if !found.iter().any(|f| f.name == command.name) {
                found.push(command);
            }
        }
        found
    }

    #[cfg(test)]
    pub fn prompt_text(&self) -> &str {
        self.prompt.text()
    }

    #[cfg(test)]
    pub fn dispatch_for_test(&self, text: &str) -> Dispatch {
        self.dispatch(text)
    }

    /// The word being typed: the last one, unless the text ends in a space.
    fn active_word(&self) -> Option<&str> {
        let text = self.prompt.text();
        text.rsplit(char::is_whitespace)
            .next()
            .filter(|_| !text.ends_with(char::is_whitespace))
    }

    /// What could complete the `/command` or `@file` being typed, best first.
    pub fn suggestions(&self) -> Vec<Suggestion> {
        if self.suggestions_dismissed {
            return Vec::new();
        }
        let Some(word) = self.active_word() else {
            return Vec::new();
        };
        if let Some(query) = word.strip_prefix('@') {
            return self
                .file_matches
                .iter()
                .filter(|_| !query.is_empty())
                .map(|path| Suggestion {
                    insert: format!("@{path}"),
                    tag: String::new(),
                    detail: String::new(),
                })
                .collect();
        }
        let Some(query) = word.strip_prefix('/') else {
            return Vec::new();
        };
        let query = query.to_lowercase();
        let mut matches: Vec<(u8, &CommandChoice)> = self
            .commands
            .iter()
            .filter_map(|c| {
                let name = c.name.to_lowercase();
                if name.starts_with(&query) {
                    Some((0, c))
                } else if name.contains(&query) {
                    Some((1, c))
                } else {
                    None
                }
            })
            .collect();
        matches.sort_by_key(|(rank, _)| *rank);
        let local = "approval".starts_with(&query).then(|| Suggestion {
            insert: "/approval".to_owned(),
            tag: String::new(),
            detail: "cycle the approval mode: manual, auto, observe".to_owned(),
        });
        local
            .into_iter()
            .chain(matches.into_iter().map(|(_, c)| Suggestion {
                insert: format!("/{}", c.name),
                tag: if c.source == "command" {
                    String::new()
                } else {
                    c.source.clone()
                },
                detail: c.description.clone(),
            }))
            .collect()
    }

    /// Replaces the word being typed with `insert` and a space, so that more can follow, such as another skill.
    fn complete_word(&mut self, insert: &str) {
        let text = self.prompt.text();
        let start = text.rfind(char::is_whitespace).map_or(0, |i| i + 1);
        let completed = format!("{}{insert} ", &text[..start]);
        self.prompt.set_text(&completed);
    }

    /// Looks up the files matching the `@word` being typed.
    fn search_files(&self) -> Cmd<Msg> {
        let Some(query) = self
            .active_word()
            .and_then(|word| word.strip_prefix('@'))
            .filter(|q| !q.is_empty())
        else {
            return Cmd::none();
        };
        let (client, query) = (self.client.clone(), query.to_owned());
        Cmd::perform(move || {
            let found = client.find_files(&query);
            Msg::FilesFound(query, found)
        })
    }

    fn suggestion_key(&mut self, key: KeyEvent, count: usize) -> Option<Cmd<Msg>> {
        let selected = self
            .suggestions()
            .get(self.suggestion.min(count - 1))
            .map(|s| s.insert.clone())?;
        match key.code {
            KeyCode::Up => self.suggestion = self.suggestion.checked_sub(1).unwrap_or(count - 1),
            KeyCode::Down => self.suggestion = (self.suggestion + 1) % count,
            KeyCode::Tab => self.complete_word(&selected),
            // Enter sends when the word is already complete, and completes it when it is not.
            KeyCode::Enter if self.active_word() != Some(selected.as_str()) => {
                self.complete_word(&selected)
            }
            KeyCode::Esc => self.suggestions_dismissed = true,
            _ => return None,
        }
        Some(Cmd::none())
    }

    fn open_session(
        &mut self,
        id: String,
        title: String,
        parent: Option<(String, String)>,
    ) -> Cmd<Msg> {
        let client = self.client.clone();
        Cmd::perform(move || {
            let messages = client.messages(&id);
            Msg::Loaded {
                id,
                title,
                parent,
                messages,
            }
        })
    }

    fn load_todos(&self, session: &str) -> Cmd<Msg> {
        let (client, session) = (self.client.clone(), session.to_owned());
        Cmd::perform(move || {
            let todos = client.todos(&session);
            Msg::TodosLoaded(session, todos)
        })
    }

    fn palette(&self, query: &str) -> Picker<Action> {
        let mut entries = vec![
            Entry::new("New session", "ctrl+n", Action::NewSession),
            Entry::new("Switch session", "ctrl+o", Action::Sessions),
            Entry::new("Switch model", "ctrl+s", Action::Models),
            Entry::new("Switch agent", "tab", Action::Agents),
            Entry::new("Change theme", "ctrl+t", Action::Themes),
            Entry::new(
                "Theme mode",
                format!(
                    "{} · switch to {}",
                    self.theme_mode.name(),
                    self.theme_mode.other().name()
                ),
                Action::ThemeMode,
            ),
            Entry::new(
                "Change approval mode",
                self.permission_mode.clone(),
                Action::PermissionMode,
            ),
            Entry::new("Rename session", "", Action::Rename),
            Entry::new("Fork session", "", Action::Fork),
            Entry::new(
                "Compact session",
                "summarize to free context",
                Action::Compact,
            ),
            Entry::new("Delete session", "", Action::Delete),
            Entry::new("Copy last answer", "", Action::CopyAnswer),
            Entry::new(
                "Connect a provider",
                "ctrl+k · API key or sign in",
                Action::Connect,
            ),
            Entry::new("Skills", "insert a /skill into the message", Action::Skills),
            Entry::new("MCP servers", "connect or disconnect", Action::Mcp),
            Entry::new(
                "Thinking level",
                self.choice
                    .variant
                    .clone()
                    .unwrap_or_else(|| "default".to_owned()),
                Action::Variants,
            ),
            Entry::new(
                "Stash message",
                "set the message aside",
                Action::StashPrompt,
            ),
            Entry::new(
                "Restore stashed message",
                format!("{} stashed", self.store.stash.len()),
                Action::RestoreStash,
            ),
            Entry::new(
                "Subagent sessions",
                "open one a subagent ran",
                Action::Subagents,
            ),
            Entry::new("Toggle sidebar", "ctrl+b", Action::ToggleSidebar),
            Entry::new("Quit", "ctrl+c", Action::Quit),
        ];
        if let Some((_, title)) = &self.parent_session {
            entries.insert(
                0,
                Entry::new(
                    "Back to the parent session",
                    title.clone(),
                    Action::ParentSession,
                ),
            );
        }
        entries.extend(self.commands.iter().map(|c| {
            Entry::new(
                format!("/{}", c.name),
                c.description.clone(),
                Action::Command(c.name.clone()),
            )
        }));
        Picker::new("commands", entries).with_query(query)
    }

    /// Loads what the connect dialog lists; the dialog opens when it arrives.
    fn open_connect(&self) -> Cmd<Msg> {
        let client = self.client.clone();
        Cmd::perform(move || {
            Msg::ConnectLoaded(
                client
                    .providers()
                    .and_then(|providers| Ok((providers, client.provider_auth()?))),
            )
        })
    }

    /// Carries out what the connect dialog asked for.
    fn connect_effect(&mut self, effect: Effect) -> Cmd<Msg> {
        let client = self.client.clone();
        match effect {
            Effect::None => Cmd::none(),
            Effect::Close => {
                self.dialog = None;
                Cmd::none()
            }
            Effect::Authorize {
                provider,
                method,
                inputs,
            } => Cmd::perform(move || {
                let authorization = client.oauth_authorize(&provider.id, method, &inputs);
                Msg::Authorized(provider, method, authorization)
            }),
            Effect::SaveKey {
                provider,
                key,
                metadata,
            } => Cmd::perform(move || {
                let saved = client.save_api_key(&provider.id, &key, &metadata);
                Msg::ConnectSaved(provider, saved)
            }),
            Effect::Callback {
                provider,
                method,
                code,
            } => Cmd::perform(move || {
                let finished = client.oauth_callback(&provider.id, method, code.as_deref());
                Msg::ConnectSaved(provider, finished)
            }),
            Effect::Copy(text) => self.copy(&text),
            Effect::Open(url) => {
                Cmd::perform(move || Msg::Done("open browser", crate::browser::open(&url)))
            }
        }
    }

    /// Recently used models first, then every model by provider and name.
    fn model_entries(&self, only_provider: Option<&str>) -> Vec<Entry<ModelSelection>> {
        let active = self.active_model();
        let selection = |m: &ModelChoice| ModelSelection {
            provider_id: m.provider_id.clone(),
            model_id: m.model_id.clone(),
        };
        let entry = |m: &ModelChoice, detail: String| {
            Entry::new(m.name.clone(), detail, selection(m))
                .current(active.as_deref() == Some(selection(m).qualified().as_str()))
        };
        let mut sorted: Vec<&ModelChoice> = self
            .models
            .iter()
            .filter(|m| only_provider.is_none_or(|id| m.provider_id == id))
            .collect();
        sorted.sort_by_cached_key(|m| (m.provider_name.to_lowercase(), m.name.to_lowercase()));
        let is_recent =
            |m: &ModelChoice| self.store.recent_models.contains(&selection(m).qualified());
        let recent = self.store.recent_models.iter().filter_map(|qualified| {
            sorted
                .iter()
                .find(|m| selection(m).qualified() == *qualified)
                .map(|m| entry(m, format!("recent · {}", m.provider_name)))
        });
        let rest = sorted
            .iter()
            .filter(|m| !is_recent(m))
            .map(|m| entry(m, m.provider_name.clone()));
        recent.chain(rest).collect()
    }

    /// The model the next message goes to, as the server lists it.
    fn active_model_choice(&self) -> Option<&ModelChoice> {
        let active = self.active_model()?;
        self.models
            .iter()
            .find(|m| format!("{}/{}", m.provider_id, m.model_id) == active)
    }

    /// The MCP servers with their state, the cursor on `keep` when given.
    fn mcp_picker(&self, keep: Option<&str>) -> Picker<String> {
        let entries = self
            .mcp
            .iter()
            .map(|(name, status)| {
                Entry::new(name.clone(), status.replace('_', " "), name.clone())
                    .current(status == "connected")
            })
            .collect();
        let mut picker =
            Picker::new("MCP servers · enter connects or disconnects", entries).at_top();
        if let Some(name) = keep {
            picker.select_matching(|value| value == name);
        }
        picker
    }

    fn cycle_agent(&mut self) -> Cmd<Msg> {
        if self.agents.is_empty() {
            return Cmd::none();
        }
        let current = self
            .choice
            .agent
            .as_deref()
            .and_then(|name| self.agents.iter().position(|a| a.name == name));
        let next = current.map_or(0, |i| (i + 1) % self.agents.len());
        self.choice.agent = Some(self.agents[next].name.clone());
        self.store.agent = self.choice.agent.clone();
        let text = format!("agent: {}", self.agents[next].name);
        Cmd::batch([self.save(), self.toast(text, self.theme.accent)])
    }

    fn run(&mut self, action: Action) -> Cmd<Msg> {
        match action {
            Action::NewSession => {
                self.reset_session();
                Cmd::none()
            }
            Action::Sessions => {
                let client = self.client.clone();
                Cmd::perform(move || Msg::SessionsLoaded(client.sessions()))
            }
            Action::Models => {
                self.dialog = Some(Dialog::Models(Picker::new(
                    "models",
                    self.model_entries(None),
                )));
                Cmd::none()
            }
            Action::Agents => {
                let entries = self
                    .agents
                    .iter()
                    .map(|a| {
                        Entry::new(a.name.clone(), a.description.clone(), a.name.clone())
                            .current(self.choice.agent.as_deref() == Some(a.name.as_str()))
                    })
                    .collect();
                self.dialog = Some(Dialog::Agents(Picker::new("agents", entries)));
                Cmd::none()
            }
            Action::Themes => {
                self.theme_before = Some(self.theme);
                let entries = themes::all(self.theme_mode)
                    .iter()
                    .map(|t| {
                        Entry::new(
                            t.name,
                            if t.paints {
                                "paints its background"
                            } else {
                                ""
                            },
                            t.name,
                        )
                        .current(t.name == self.theme.name)
                    })
                    .collect();
                self.dialog = Some(Dialog::Themes(Picker::new("themes", entries)));
                Cmd::none()
            }
            Action::ThemeMode => {
                self.theme_mode = self.theme_mode.other();
                self.store.theme_mode = Some(self.theme_mode.name().to_owned());
                let theme = themes::find(self.theme.name, self.theme_mode).unwrap_or_default();
                self.apply_theme(theme);
                self.save()
            }
            Action::PermissionMode if self.permission_mode == "unguarded" => self.toast(
                "unguarded mode cannot be changed from here",
                self.theme.warn,
            ),
            Action::PermissionMode => {
                let next = PERMISSION_MODES
                    .iter()
                    .position(|m| *m == self.permission_mode)
                    .map_or(PERMISSION_MODES[0], |i| {
                        PERMISSION_MODES[(i + 1) % PERMISSION_MODES.len()]
                    });
                let client = self.client.clone();
                Cmd::perform(move || {
                    Msg::ModeChanged(client.set_permission_mode(next).map(|()| next.to_owned()))
                })
            }
            Action::Rename if self.session.is_some() => {
                self.dialog = Some(Dialog::Rename(TextDialog::new(
                    "rename session",
                    &self.session_title,
                )));
                Cmd::none()
            }
            Action::Delete if self.session.is_some() => {
                self.dialog = Some(Dialog::ConfirmDelete);
                Cmd::none()
            }
            Action::Fork => match self.session.clone() {
                Some(session) => {
                    let client = self.client.clone();
                    Cmd::perform(move || Msg::Forked(client.fork_session(&session)))
                }
                None => self.toast("nothing to fork yet", self.theme.warn),
            },
            Action::Compact => match (
                self.session.clone(),
                self.active_model()
                    .as_deref()
                    .and_then(ModelSelection::parse),
            ) {
                (Some(session), Some(model)) => {
                    let client = self.client.clone();
                    Cmd::batch([
                        self.start_working(),
                        Cmd::perform(move || {
                            Msg::Done("compact", client.compact(&session, &model))
                        }),
                    ])
                }
                _ => self.toast("nothing to compact yet", self.theme.warn),
            },
            Action::CopyAnswer => match self.transcript.last_answer().map(str::to_owned) {
                Some(text) => self.copy(&text),
                None => self.toast("no answer to copy", self.theme.warn),
            },
            Action::ToggleSidebar => {
                self.sidebar = !self.sidebar;
                Cmd::none()
            }
            Action::Quit => Cmd::quit(),
            Action::Connect => self.open_connect(),
            Action::Skills => {
                let entries = self
                    .commands
                    .iter()
                    .filter(|c| c.source == "skill")
                    .map(|c| {
                        Entry::new(
                            format!("/{}", c.name),
                            crate::view::first_sentence(&c.description),
                            c.name.clone(),
                        )
                    })
                    .collect::<Vec<_>>();
                if entries.is_empty() {
                    return self.toast("no skills installed", self.theme.warn);
                }
                self.dialog = Some(Dialog::Skills(Picker::new("skills", entries)));
                Cmd::none()
            }
            Action::Mcp => {
                if self.mcp.is_empty() {
                    return self.toast("no MCP servers configured", self.theme.warn);
                }
                self.dialog = Some(Dialog::Mcp(self.mcp_picker(None)));
                Cmd::none()
            }
            Action::Variants => {
                let offered = self
                    .active_model_choice()
                    .map(|m| m.variants.clone())
                    .unwrap_or_default();
                if offered.is_empty() {
                    return self.toast("this model has no thinking levels", self.theme.warn);
                }
                let mut entries = vec![
                    Entry::new("default", "the model's own", None)
                        .current(self.choice.variant.is_none()),
                ];
                entries.extend(offered.into_iter().map(|v| {
                    Entry::new(v.clone(), "", Some(v.clone()))
                        .current(self.choice.variant.as_deref() == Some(v.as_str()))
                }));
                self.dialog = Some(Dialog::Variants(Picker::new("thinking level", entries)));
                Cmd::none()
            }
            Action::StashPrompt => {
                let text = self.prompt.take();
                if text.is_empty() {
                    return self.toast("nothing to stash", self.theme.warn);
                }
                self.store.push_stash(&text);
                Cmd::batch([self.save(), self.toast("message stashed", self.theme.ok)])
            }
            Action::RestoreStash => {
                if self.store.stash.is_empty() {
                    return self.toast("the stash is empty", self.theme.warn);
                }
                let entries = self
                    .store
                    .stash
                    .iter()
                    .enumerate()
                    .rev()
                    .map(|(i, text)| {
                        let lines = text.lines().count();
                        Entry::new(
                            crate::view::ellipsize(text.lines().next().unwrap_or_default(), 60),
                            format!("{lines} line{}", if lines == 1 { "" } else { "s" }),
                            i,
                        )
                    })
                    .collect();
                self.dialog = Some(Dialog::Stash(Picker::new("stash", entries)));
                Cmd::none()
            }
            Action::Subagents => match self.session.clone() {
                Some(session) => {
                    let client = self.client.clone();
                    Cmd::perform(move || Msg::ChildrenLoaded(client.children(&session)))
                }
                None => self.toast("open a session first", self.theme.warn),
            },
            Action::ParentSession => match self.parent_session.clone() {
                Some((id, title)) => self.open_session(id, title, None),
                None => Cmd::none(),
            },
            Action::Rename | Action::Delete => self.toast("open a session first", self.theme.warn),
            Action::Command(name) => {
                self.prompt.set_text(&format!("/{name} "));
                Cmd::none()
            }
        }
    }

    fn copy(&mut self, text: &str) -> Cmd<Msg> {
        Cmd::batch([
            Cmd::copy_to_clipboard(text),
            self.toast("copied to clipboard", self.theme.ok),
        ])
    }

    fn dialog_key(&mut self, key: KeyEvent) -> Cmd<Msg> {
        let Some(dialog) = self.dialog.take() else {
            return Cmd::none();
        };
        match dialog {
            Dialog::Connect(mut connect) => {
                let effect = connect.handle_key(key);
                if effect != Effect::Close {
                    self.dialog = Some(Dialog::Connect(connect));
                }
                self.connect_effect(effect)
            }
            Dialog::Mcp(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Mcp(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(name) => {
                    let connected = self
                        .mcp
                        .iter()
                        .any(|(n, status)| *n == name && status == "connected");
                    let client = self.client.clone();
                    self.dialog = Some(Dialog::Mcp(picker));
                    Cmd::perform(move || {
                        let toggled = client
                            .set_mcp_connected(&name, !connected)
                            .and_then(|()| client.mcp_servers());
                        Msg::McpToggled(name, toggled)
                    })
                }
            },
            Dialog::Skills(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Skills(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(name) => {
                    self.prompt.set_text(&format!("/{name} "));
                    Cmd::none()
                }
            },
            Dialog::Variants(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Variants(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(variant) => {
                    let text = format!("thinking: {}", variant.as_deref().unwrap_or("default"));
                    self.choice.variant = variant;
                    self.toast(text, self.theme.accent)
                }
            },
            Dialog::Stash(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Stash(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(index) => {
                    let current = self.prompt.take();
                    if let Some(text) = self.store.pop_stash(index) {
                        // What was being typed is not lost: it takes the place in the stash.
                        if !current.is_empty() {
                            self.store.push_stash(&current);
                        }
                        self.prompt.set_text(&text);
                    }
                    self.save()
                }
            },
            Dialog::Subagents(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Subagents(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen((id, title)) => {
                    let parent = self
                        .session
                        .clone()
                        .map(|id| (id, self.session_title.clone()));
                    self.open_session(id, title, parent)
                }
            },
            Dialog::Palette(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Palette(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(action) => self.run(action),
            },
            Dialog::Sessions(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Sessions(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen((id, title, parent)) => self.open_session(id, title, parent),
            },
            Dialog::Models(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Models(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(model) => {
                    let text = format!("model: {}", model.qualified());
                    self.store.remember_model(&model.qualified());
                    self.store.model = Some(model.qualified());
                    self.choice.variant = None;
                    self.choice.model = Some(model);
                    Cmd::batch([self.save(), self.toast(text, self.theme.accent)])
                }
            },
            Dialog::Agents(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.dialog = Some(Dialog::Agents(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => Cmd::none(),
                Outcome::Chosen(agent) => {
                    self.store.agent = Some(agent.clone());
                    self.choice.agent = Some(agent);
                    self.save()
                }
            },
            Dialog::Themes(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    if let Some(theme) = picker
                        .highlighted()
                        .and_then(|name| themes::find(name, self.theme_mode))
                    {
                        self.apply_theme(theme);
                    }
                    self.dialog = Some(Dialog::Themes(picker));
                    Cmd::none()
                }
                Outcome::Cancelled => {
                    if let Some(before) = self.theme_before.take() {
                        self.apply_theme(before);
                    }
                    Cmd::none()
                }
                Outcome::Chosen(name) => {
                    self.theme_before = None;
                    self.apply_theme(themes::find(name, self.theme_mode).unwrap_or_default());
                    self.save()
                }
            },
            Dialog::Rename(mut text) => match text.handle_key(key) {
                TextOutcome::Pending => {
                    self.dialog = Some(Dialog::Rename(text));
                    Cmd::none()
                }
                TextOutcome::Cancelled => Cmd::none(),
                TextOutcome::Submitted(title) => match self.session.clone() {
                    Some(session) => {
                        self.session_title = title.clone();
                        let client = self.client.clone();
                        Cmd::perform(move || {
                            Msg::Done("rename", client.rename_session(&session, &title))
                        })
                    }
                    None => Cmd::none(),
                },
            },
            Dialog::ConfirmDelete => match key.code {
                KeyCode::Char('y') => match self.session.clone() {
                    Some(session) => {
                        let client = self.client.clone();
                        Cmd::perform(move || Msg::Deleted(client.delete_session(&session)))
                    }
                    None => Cmd::none(),
                },
                KeyCode::Char('n') | KeyCode::Esc => Cmd::none(),
                _ => {
                    self.dialog = Some(Dialog::ConfirmDelete);
                    Cmd::none()
                }
            },
        }
    }

    fn key(&mut self, key: KeyEvent) -> Cmd<Msg> {
        if let Some(permission) = &self.permission {
            let Some(reply) = Permission::reply_for(key) else {
                return Cmd::none();
            };
            let (client, id) = (self.client.clone(), permission.id.clone());
            self.permission = None;
            return Cmd::perform(move || {
                Msg::Done("permission", client.reply_permission(&id, reply))
            });
        }
        if let Some(question) = &mut self.question {
            let outcome = question.handle_key(key);
            let id = question.id.clone();
            let client = self.client.clone();
            return match outcome {
                QuestionOutcome::Pending => Cmd::none(),
                QuestionOutcome::Rejected => {
                    self.question = None;
                    Cmd::perform(move || Msg::Done("question", client.reject_question(&id)))
                }
                QuestionOutcome::Answered(answers) => {
                    self.question = None;
                    Cmd::perform(move || {
                        Msg::Done("question", client.reply_question(&id, &answers))
                    })
                }
            };
        }
        if self.dialog.is_some() {
            return self.dialog_key(key);
        }
        self.global_key(key)
    }

    fn global_key(&mut self, key: KeyEvent) -> Cmd<Msg> {
        if key.is_ctrl('p') {
            self.dialog = Some(Dialog::Palette(self.palette("")));
            return Cmd::none();
        }
        if key.is_ctrl('o') {
            return self.run(Action::Sessions);
        }
        if key.is_ctrl('k') {
            return self.run(Action::Connect);
        }
        if key.is_ctrl('n') {
            return self.run(Action::NewSession);
        }
        if key.is_ctrl('s') {
            return self.run(Action::Models);
        }
        if key.is_ctrl('t') {
            return self.run(Action::Themes);
        }
        if key.is_ctrl('b') {
            return self.run(Action::ToggleSidebar);
        }
        let count = self.suggestions().len();
        if count > 0 {
            if let Some(handled) = self.suggestion_key(key, count) {
                return handled;
            }
        }
        if key.is_ctrl('j') {
            self.prompt.newline();
            return Cmd::none();
        }
        if key.code == KeyCode::Char('m') && key.modifiers.contains(KeyModifiers::ALT) {
            return self.run(Action::PermissionMode);
        }
        match key.code {
            KeyCode::Tab => self.cycle_agent(),
            KeyCode::Enter
                if key.modifiers.contains(KeyModifiers::SHIFT)
                    || key.modifiers.contains(KeyModifiers::ALT) =>
            {
                self.prompt.newline();
                Cmd::none()
            }
            KeyCode::Enter if self.prompt.continues_on_next_line() => Cmd::none(),
            KeyCode::Enter => {
                let text = self.prompt.take();
                if text.is_empty() {
                    return Cmd::none();
                }
                if text == "/approval" {
                    return self.run(Action::PermissionMode);
                }
                self.submit(text)
            }
            KeyCode::Esc if self.busy && !self.interrupt_armed => {
                self.interrupt_armed = true;
                self.arm()
            }
            KeyCode::Esc if self.busy => {
                self.interrupt_armed = false;
                match self.session.clone() {
                    Some(session) => {
                        let client = self.client.clone();
                        Cmd::perform(move || Msg::Done("abort", client.abort(&session)))
                    }
                    None => Cmd::none(),
                }
            }
            KeyCode::PageUp => {
                self.transcript.history.page_up();
                Cmd::none()
            }
            KeyCode::PageDown => {
                self.transcript.history.page_down();
                Cmd::none()
            }
            _ => {
                self.prompt.handle_key(key);
                self.suggestion = 0;
                self.suggestions_dismissed = false;
                self.search_files()
            }
        }
    }

    fn server_event(&mut self, event: &GlobalEvent) -> Cmd<Msg> {
        let properties = event.properties();
        let event_session = properties["sessionID"].as_str().or_else(|| {
            properties["info"]["id"]
                .as_str()
                .filter(|_| event.kind().starts_with("session."))
        });
        if event_session.is_none() || event_session != self.session.as_deref() {
            return Cmd::none();
        }
        match event.kind() {
            "message.updated" => {
                self.transcript.apply_message(&properties["info"]);
                // Nothing was chosen or configured: keep using the model the server picked, and show it.
                if self.choice.model.is_none() {
                    self.choice.model = self
                        .transcript
                        .model
                        .as_deref()
                        .and_then(ModelSelection::parse);
                    self.store.model = self.transcript.model.clone();
                    return self.save();
                }
            }
            "message.part.updated" => self.transcript.apply_part(&properties["part"]),
            "message.part.delta" => {
                if let (Some(part), Some(field), Some(delta)) = (
                    properties["partID"].as_str(),
                    properties["field"].as_str(),
                    properties["delta"].as_str(),
                ) {
                    self.transcript.apply_delta(part, field, delta);
                }
            }
            "session.updated" => {
                if let Some(title) = properties["info"]["title"].as_str() {
                    self.session_title = display_title(title);
                }
            }
            "todo.updated" => {
                self.todos = serde_json::from_value(properties["todos"].clone()).unwrap_or_default()
            }
            "permission.asked" => {
                self.permission = Some(Permission::from_event(
                    properties,
                    &self.client.raw_directory(),
                ))
            }
            "question.asked" => self.question = Some(Question::from_event(properties)),
            "session.idle" => self.stop_working(),
            "session.status" if properties["status"]["type"] == "idle" => self.stop_working(),
            "session.error" => {
                self.stop_working();
                let error = &properties["error"];
                let message = error["data"]["message"].as_str().or(error["name"].as_str());
                if message != Some("MessageAbortedError") {
                    return self.fail(message.unwrap_or("the session failed").to_owned());
                }
            }
            _ => {}
        }
        Cmd::none()
    }
}

impl App for CrewCode {
    type Message = Msg;

    fn init(&self) -> Cmd<Msg> {
        let (health, events, models, agents, commands, mode, info) = (
            self.client.clone(),
            self.client.clone(),
            self.client.clone(),
            self.client.clone(),
            self.client.clone(),
            self.client.clone(),
            self.client.clone(),
        );
        Cmd::batch([
            Cmd::perform(move || Msg::Connected(health.health())),
            Cmd::perform(move || Msg::ModelsLoaded(models.models())),
            Cmd::perform(move || Msg::AgentsLoaded(agents.agents())),
            Cmd::perform(move || Msg::CommandsLoaded(commands.commands())),
            Cmd::perform(move || Msg::ModeLoaded(mode.permission_mode())),
            Cmd::perform(move || Msg::InfoLoaded(info.branch(), info.mcp_servers())),
            self.resolve_start(),
            Cmd::spawn(move |tx| {
                let reason = events
                    .follow_events(|event| tx.send(Msg::Server(event)).is_ok())
                    .err()
                    .unwrap_or_else(|| "the event stream closed".to_owned());
                let _ = tx.send(Msg::StreamEnded(reason));
            }),
        ])
    }

    fn event(&self, event: Event) -> Option<Msg> {
        match event {
            Event::Key(key) if key.kind == KeyEventKind::Release => None,
            Event::Key(key) if key.is_ctrl('c') => Some(Msg::CtrlC),
            Event::Key(key) => Some(Msg::Key(key)),
            Event::Paste(text) => Some(Msg::Paste(text)),
            Event::Mouse(mouse) => match mouse.kind {
                MouseKind::ScrollUp => Some(Msg::Scroll(-3)),
                MouseKind::ScrollDown => Some(Msg::Scroll(3)),
                _ => None,
            },
            _ => None,
        }
    }

    fn update(&mut self, message: Msg) -> Cmd<Msg> {
        match message {
            Msg::CtrlC if !self.prompt.is_empty() => {
                self.prompt.clear();
                Cmd::none()
            }
            Msg::CtrlC if self.busy && !self.quit_armed => {
                self.quit_armed = true;
                self.arm()
            }
            Msg::CtrlC => Cmd::quit(),
            Msg::FilesFound(query, Ok(files)) => {
                if self.active_word().and_then(|word| word.strip_prefix('@'))
                    == Some(query.as_str())
                {
                    self.file_matches = files;
                    self.suggestion = 0;
                }
                Cmd::none()
            }
            Msg::ConnectLoaded(Ok((providers, auth))) => {
                self.dialog = Some(Dialog::Connect(Box::new(Connect::new(providers, auth))));
                Cmd::none()
            }
            Msg::Authorized(provider, method, result) => {
                let Some(Dialog::Connect(connect)) = &mut self.dialog else {
                    return Cmd::none();
                };
                let automatic = result
                    .as_ref()
                    .is_ok_and(|authorization| authorization.automatic);
                let failed = result.as_ref().err().cloned();
                let effect = connect.authorized(provider.clone(), method, result);
                if let Some(error) = failed {
                    self.dialog = None;
                    return self.fail(format!("sign in failed: {error}"));
                }
                let open = self.connect_effect(effect);
                if automatic {
                    let wait = self.connect_effect(Effect::Callback {
                        provider,
                        method,
                        code: None,
                    });
                    return Cmd::batch([open, wait]);
                }
                open
            }
            Msg::ConnectSaved(provider, Ok(())) => {
                self.dialog = None;
                let client = self.client.clone();
                let id = provider.id.clone();
                let toast = self.toast(format!("connected {}", provider.name), self.theme.ok);
                Cmd::batch([
                    toast,
                    Cmd::perform(move || Msg::ConnectedModels(id, client.models())),
                ])
            }
            Msg::ConnectSaved(_, Err(error)) => {
                if matches!(self.dialog, Some(Dialog::Connect(_))) {
                    self.dialog = None;
                }
                self.fail(format!("could not connect: {error}"))
            }
            Msg::ConnectedModels(provider, Ok((models, default))) => {
                self.models = models;
                self.default_model = default;
                if self.model_entries(Some(&provider)).is_empty() {
                    return self.toast("that provider lists no models yet", self.theme.warn);
                }
                self.dialog = Some(Dialog::Models(Picker::new(
                    "choose a model",
                    self.model_entries(Some(&provider)),
                )));
                Cmd::none()
            }
            Msg::McpToggled(name, Ok(servers)) => {
                self.mcp = servers;
                if matches!(self.dialog, Some(Dialog::Mcp(_))) {
                    self.dialog = Some(Dialog::Mcp(self.mcp_picker(Some(&name))));
                }
                Cmd::none()
            }
            Msg::ChildrenLoaded(Ok(children)) => {
                if children.is_empty() {
                    return self.toast("no subagent ran in this session", self.theme.warn);
                }
                let entries = children
                    .iter()
                    .map(|s| {
                        let title = display_title(&s.title);
                        Entry::new(
                            title.clone(),
                            crate::theme::ago(s.time.updated),
                            (s.id.clone(), title),
                        )
                    })
                    .collect();
                self.dialog = Some(Dialog::Subagents(Picker::new("subagent sessions", entries)));
                Cmd::none()
            }
            Msg::StartResolved(Ok(Some((id, title)))) => self.open_session(id, title, None),
            Msg::StartResolved(Ok(None)) => match self.pending_prompt.take() {
                Some(text) => self.submit(text),
                None => Cmd::none(),
            },
            Msg::StartResolved(Err(error)) => {
                self.pending_prompt = None;
                self.fail(format!("cannot open the session: {error}"))
            }
            Msg::FilesFound(_, Err(error)) => self.fail(format!("file search failed: {error}")),
            Msg::ArmExpired(id) => {
                if id == self.arm_count {
                    self.interrupt_armed = false;
                    self.quit_armed = false;
                }
                Cmd::none()
            }
            Msg::Key(key) => self.key(key),
            Msg::Paste(text) => {
                match &mut self.dialog {
                    Some(Dialog::Connect(connect)) => connect.paste(&text),
                    Some(Dialog::Rename(dialog)) => dialog.paste(&text),
                    Some(_) => {}
                    None => self.prompt.insert(&text),
                }
                Cmd::none()
            }
            Msg::Scroll(rows) => {
                match rows.signum() {
                    -1 => self
                        .transcript
                        .history
                        .scroll_up(rows.unsigned_abs() as usize),
                    _ => self.transcript.history.scroll_down(rows as usize),
                }
                Cmd::none()
            }
            Msg::Spin if self.busy => {
                self.spinner.tick();
                Cmd::after(SPIN_EVERY, Msg::Spin)
            }
            Msg::Spin => Cmd::none(),
            Msg::ToastExpired(id) => {
                if self.toast.as_ref().is_some_and(|t| t.id == id) {
                    self.toast = None;
                }
                Cmd::none()
            }
            Msg::Server(event) => self.server_event(&event),
            Msg::StreamEnded(reason) => self.fail(format!("lost the server: {reason}")),
            Msg::Connected(Ok(())) => Cmd::none(),
            Msg::Connected(Err(error)) => self.fail(format!("cannot reach the server: {error}")),
            Msg::ModelsLoaded(Ok((models, default))) => {
                self.models = models;
                self.default_model = default;
                if self.choice.model.is_none() {
                    self.choice.model = self
                        .default_model
                        .as_deref()
                        .and_then(ModelSelection::parse);
                }
                // A first run has nothing to talk to: start with the way to connect something.
                if self.models.is_empty() && !std::mem::replace(&mut self.connect_offered, true) {
                    return self.open_connect();
                }
                Cmd::none()
            }
            Msg::InfoLoaded(branch, mcp) => {
                self.branch = branch;
                self.mcp = mcp.unwrap_or_default();
                Cmd::none()
            }
            Msg::AgentsLoaded(Ok(agents)) => {
                self.agents = agents;
                Cmd::none()
            }
            Msg::CommandsLoaded(Ok(commands)) => {
                self.commands = commands;
                Cmd::none()
            }
            Msg::ModeLoaded(Ok(mode)) => {
                self.permission_mode = mode;
                Cmd::none()
            }
            Msg::Created(Ok(session), text) => {
                self.session = Some(session.clone());
                self.deliver(&session, text)
            }
            Msg::Created(Err(error), _) | Msg::Sent(Err(error)) => {
                self.stop_working();
                self.fail(error)
            }
            Msg::Sent(Ok(())) => Cmd::none(),
            Msg::SessionsLoaded(Ok(sessions)) => {
                let entries = sessions
                    .iter()
                    .map(|s| {
                        let title = display_title(&s.title);
                        let parent = s.parent_id.as_ref().map(|pid| {
                            let parent_title = sessions.iter().find(|p| p.id == *pid).map_or_else(
                                || "parent session".to_owned(),
                                |p| display_title(&p.title),
                            );
                            (pid.clone(), parent_title)
                        });
                        Entry::new(
                            title.clone(),
                            crate::theme::ago(s.time.updated),
                            (s.id.clone(), title, parent),
                        )
                        .current(self.session.as_deref() == Some(s.id.as_str()))
                    })
                    .collect();
                self.dialog = Some(Dialog::Sessions(Picker::new("sessions", entries)));
                Cmd::none()
            }
            Msg::Loaded {
                id,
                title,
                parent,
                messages: Ok(messages),
            } => {
                self.reset_session();
                self.session = Some(id.clone());
                self.session_title = display_title(&title);
                self.parent_session = parent;
                let send = self.pending_prompt.take();
                messages
                    .iter()
                    .for_each(|m| self.transcript.apply_stored(&m.info, &m.parts));
                let todos = self.load_todos(&id);
                match send {
                    Some(text) => Cmd::batch([todos, self.submit(text)]),
                    None => todos,
                }
            }
            Msg::TodosLoaded(session, Ok(todos)) => {
                if self.session.as_deref() == Some(session.as_str()) {
                    self.todos = todos;
                }
                Cmd::none()
            }
            Msg::Deleted(Ok(())) => {
                self.reset_session();
                self.toast("session deleted", self.theme.ok)
            }
            Msg::Forked(Ok(session)) => {
                self.open_session(session, "forked session".to_owned(), None)
            }
            Msg::ModeChanged(Ok(mode)) => {
                let text = format!("approval mode: {mode}");
                self.permission_mode = mode;
                self.toast(text, self.theme.accent)
            }
            Msg::Done(_, Ok(())) => Cmd::none(),
            Msg::ConnectLoaded(Err(error))
            | Msg::ConnectedModels(_, Err(error))
            | Msg::ModelsLoaded(Err(error))
            | Msg::AgentsLoaded(Err(error))
            | Msg::CommandsLoaded(Err(error))
            | Msg::ModeLoaded(Err(error))
            | Msg::SessionsLoaded(Err(error))
            | Msg::Loaded {
                messages: Err(error),
                ..
            }
            | Msg::McpToggled(_, Err(error))
            | Msg::ChildrenLoaded(Err(error))
            | Msg::TodosLoaded(_, Err(error))
            | Msg::Deleted(Err(error))
            | Msg::Forked(Err(error))
            | Msg::ModeChanged(Err(error)) => self.fail(error),
            Msg::Done(label, Err(error)) => self.fail(format!("{label} failed: {error}")),
        }
    }

    fn view(&self, frame: &mut crewtui::Frame<'_>) {
        crate::view::draw(self, frame);
    }
}
