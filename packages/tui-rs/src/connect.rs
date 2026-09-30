//! Connecting a provider: choosing one, then an API key or a login in the browser.

use std::collections::HashMap;

use crewtui::text::{Line, Span, Text};
use crewtui::widgets::{Block, BorderType, Clear, Paragraph};
use crewtui::{Edges, Frame, KeyCode, KeyEvent, Rect, Style};

use crate::client::{AuthMethod, AuthPrompt, Authorization, ProviderInfo};
use crate::dialogs::{TextDialog, TextOutcome};
use crate::picker::{Entry, Outcome, Picker};
use crate::theme::Theme;

/// Providers listed first, with what the user connects with.
const POPULAR: [(&str, &str); 3] = [
    ("openai-codex", "ChatGPT Plus/Pro account"),
    ("openai", "API key"),
    ("openrouter", "API key"),
];

/// A provider chosen in the list: its id and name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Provider {
    pub id: String,
    pub name: String,
}

/// What the app must do next on behalf of the dialog.
#[derive(Debug, PartialEq, Eq)]
pub enum Effect {
    None,
    Close,
    /// Start a browser login.
    Authorize {
        provider: Provider,
        method: usize,
        inputs: HashMap<String, String>,
    },
    /// Store an API key.
    SaveKey {
        provider: Provider,
        key: String,
        metadata: HashMap<String, String>,
    },
    /// Finish a browser login with a pasted code, or by waiting for the browser.
    Callback {
        provider: Provider,
        method: usize,
        code: Option<String>,
    },
    Copy(String),
    Open(String),
}

/// A choice in the provider list: a provider, or the way in to any other by its id.
#[derive(Debug, Clone)]
enum Listed {
    Provider(Provider),
    Other,
}

/// The question being asked before a login can start.
enum Ask {
    Text(TextDialog),
    Select(Picker<String>),
}

enum Step {
    Providers(Picker<Listed>),
    Methods {
        provider: Provider,
        methods: Vec<AuthMethod>,
        picker: Picker<usize>,
    },
    Asking {
        provider: Provider,
        method: usize,
        definition: AuthMethod,
        inputs: HashMap<String, String>,
        asked: usize,
        ask: Ask,
    },
    Key {
        provider: Provider,
        metadata: HashMap<String, String>,
        field: TextDialog,
    },
    Code {
        provider: Provider,
        method: usize,
        authorization: Authorization,
        field: TextDialog,
    },
    Waiting {
        authorization: Authorization,
    },
    Working(&'static str),
    OtherId(TextDialog),
}

pub struct Connect {
    step: Step,
    auth: HashMap<String, Vec<AuthMethod>>,
}

/// Provider ids are lowercase letters, digits and hyphens.
fn valid_provider_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// `text` cut into rows of at most `width` characters, for a link that must stay copyable.
fn wrap_chars(text: &str, width: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(width.max(1))
        .map(|row| row.iter().collect())
        .collect()
}

impl Connect {
    pub fn new(providers: Vec<ProviderInfo>, auth: HashMap<String, Vec<AuthMethod>>) -> Self {
        let mut listed: Vec<ProviderInfo> = providers;
        listed.sort_by_key(|p| {
            (
                POPULAR
                    .iter()
                    .position(|(id, _)| *id == p.id)
                    .unwrap_or(POPULAR.len()),
                p.name.to_lowercase(),
                p.id.clone(),
            )
        });
        let mut entries: Vec<Entry<Listed>> = listed
            .into_iter()
            .map(|p| {
                let hint = POPULAR
                    .iter()
                    .find(|(id, _)| *id == p.id)
                    .map_or("", |(_, hint)| *hint);
                let detail = match (p.connected, hint.is_empty()) {
                    (true, true) => "connected".to_owned(),
                    (true, false) => format!("connected · {hint}"),
                    (false, _) => hint.to_owned(),
                };
                Entry::new(
                    p.name.clone(),
                    detail,
                    Listed::Provider(Provider {
                        id: p.id,
                        name: p.name,
                    }),
                )
                .current(p.connected)
            })
            .collect();
        entries.push(Entry::new(
            "Other provider…",
            "any provider by its id, for example deepseek",
            Listed::Other,
        ));
        Self {
            step: Step::Providers(Picker::new("connect a provider", entries).at_top()),
            auth,
        }
    }

    fn api_key_step(provider: Provider, metadata: HashMap<String, String>) -> Step {
        let field = TextDialog::new(&format!("{} · API key", provider.name), "")
            .masked()
            .placeholder("paste your API key")
            .notes(vec![
                Line::from(Span::raw(
                    "The key is stored by the server on this computer.",
                )),
                Line::default(),
            ]);
        Step::Key {
            provider,
            metadata,
            field,
        }
    }

    /// Moves to the step after choosing `method`.
    fn begin(&mut self, provider: Provider, method: usize, definition: AuthMethod) -> Effect {
        self.ask_from(provider, method, definition, HashMap::new(), 0)
    }

    /// Asks the next applicable question from `from` on, or finishes the questions.
    fn ask_from(
        &mut self,
        provider: Provider,
        method: usize,
        definition: AuthMethod,
        inputs: HashMap<String, String>,
        from: usize,
    ) -> Effect {
        let applies = |prompt: &AuthPrompt| {
            prompt.condition.as_ref().is_none_or(|c| {
                inputs
                    .get(&c.key)
                    .is_some_and(|value| (*value == c.value) != c.negated)
            })
        };
        let next = definition
            .prompts
            .iter()
            .enumerate()
            .skip(from)
            .find(|(_, prompt)| applies(prompt))
            .map(|(i, prompt)| (i, prompt.clone()));
        let Some((asked, prompt)) = next else {
            return if definition.oauth {
                self.step = Step::Working("Starting the login…");
                Effect::Authorize {
                    provider,
                    method,
                    inputs,
                }
            } else {
                self.step = Self::api_key_step(provider, inputs);
                Effect::None
            };
        };
        let ask = if prompt.options.is_empty() {
            Ask::Text(TextDialog::new(&prompt.message, "").placeholder(&prompt.placeholder))
        } else {
            let entries = prompt
                .options
                .iter()
                .map(|(label, value, hint)| Entry::new(label.clone(), hint.clone(), value.clone()))
                .collect();
            Ask::Select(Picker::new(prompt.message.clone(), entries))
        };
        self.step = Step::Asking {
            provider,
            method,
            definition,
            inputs,
            asked,
            ask,
        };
        Effect::None
    }

    /// Called when the server answered a request to start a login.
    pub fn authorized(
        &mut self,
        provider: Provider,
        method: usize,
        result: Result<Authorization, String>,
    ) -> Effect {
        match result {
            Err(_) => Effect::Close,
            Ok(authorization) if authorization.automatic => {
                let open = Effect::Open(authorization.url.clone());
                self.step = Step::Waiting { authorization };
                let _ = (provider, method);
                open
            }
            Ok(authorization) => {
                let mut notes = vec![Line::from(Span::raw(authorization.instructions.clone()))];
                notes.extend(
                    wrap_chars(&authorization.url, 68)
                        .into_iter()
                        .map(|row| Line::from(Span::raw(row).link(authorization.url.clone()))),
                );
                let field = TextDialog::new("Authorization code", "")
                    .placeholder("paste the code")
                    .notes(notes);
                let open = Effect::Open(authorization.url.clone());
                self.step = Step::Code {
                    provider,
                    method,
                    authorization,
                    field,
                };
                open
            }
        }
    }

    /// The URL or code the copy key puts on the clipboard while waiting for the browser.
    fn copyable(authorization: &Authorization) -> String {
        authorization
            .instructions
            .split_whitespace()
            .find(|word| {
                word.contains('-')
                    && word.chars().filter(char::is_ascii_alphanumeric).count() >= 8
                    && word
                        .chars()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
            })
            .map_or_else(|| authorization.url.clone(), str::to_owned)
    }

    pub fn paste(&mut self, text: &str) {
        match &mut self.step {
            Step::Key { field, .. } | Step::Code { field, .. } | Step::OtherId(field) => {
                field.paste(text)
            }
            Step::Asking {
                ask: Ask::Text(field),
                ..
            } => field.paste(text),
            _ => {}
        }
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> Effect {
        let step = std::mem::replace(&mut self.step, Step::Working(""));
        match step {
            Step::Providers(mut picker) => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.step = Step::Providers(picker);
                    Effect::None
                }
                Outcome::Cancelled => Effect::Close,
                Outcome::Chosen(Listed::Other) => {
                    self.step =
                        Step::OtherId(TextDialog::new("Provider id", "").placeholder("deepseek"));
                    Effect::None
                }
                Outcome::Chosen(Listed::Provider(provider)) => self.choose_provider(provider),
            },
            Step::Methods {
                provider,
                methods,
                mut picker,
            } => match picker.handle_key(key) {
                Outcome::Pending => {
                    self.step = Step::Methods {
                        provider,
                        methods,
                        picker,
                    };
                    Effect::None
                }
                Outcome::Cancelled => Effect::Close,
                Outcome::Chosen(index) => {
                    let definition = methods[index].clone();
                    self.begin(provider, index, definition)
                }
            },
            Step::Asking {
                provider,
                method,
                definition,
                mut inputs,
                asked,
                ask,
            } => {
                let answer = match ask {
                    Ask::Text(mut dialog) => match dialog.handle_key(key) {
                        TextOutcome::Pending => {
                            self.step = Step::Asking {
                                provider,
                                method,
                                definition,
                                inputs,
                                asked,
                                ask: Ask::Text(dialog),
                            };
                            return Effect::None;
                        }
                        TextOutcome::Cancelled => return Effect::Close,
                        TextOutcome::Submitted(text) => text,
                    },
                    Ask::Select(mut picker) => match picker.handle_key(key) {
                        Outcome::Pending => {
                            self.step = Step::Asking {
                                provider,
                                method,
                                definition,
                                inputs,
                                asked,
                                ask: Ask::Select(picker),
                            };
                            return Effect::None;
                        }
                        Outcome::Cancelled => return Effect::Close,
                        Outcome::Chosen(value) => value,
                    },
                };
                inputs.insert(definition.prompts[asked].key.clone(), answer);
                self.ask_from(provider, method, definition, inputs, asked + 1)
            }
            Step::Key {
                provider,
                metadata,
                mut field,
            } => match field.handle_key(key) {
                TextOutcome::Pending => {
                    self.step = Step::Key {
                        provider,
                        metadata,
                        field,
                    };
                    Effect::None
                }
                TextOutcome::Cancelled => Effect::Close,
                TextOutcome::Submitted(text) => {
                    self.step = Step::Working("Saving the key…");
                    Effect::SaveKey {
                        provider,
                        key: text,
                        metadata,
                    }
                }
            },
            Step::Code {
                provider,
                method,
                authorization,
                mut field,
            } => match field.handle_key(key) {
                TextOutcome::Pending => {
                    self.step = Step::Code {
                        provider,
                        method,
                        authorization,
                        field,
                    };
                    Effect::None
                }
                TextOutcome::Cancelled => Effect::Close,
                TextOutcome::Submitted(code) => {
                    self.step = Step::Working("Checking the code…");
                    Effect::Callback {
                        provider,
                        method,
                        code: Some(code),
                    }
                }
            },
            Step::Waiting { authorization } => {
                let effect = match key.code {
                    KeyCode::Esc => Effect::Close,
                    KeyCode::Char('c') => Effect::Copy(Self::copyable(&authorization)),
                    KeyCode::Char('o') => Effect::Open(authorization.url.clone()),
                    _ => Effect::None,
                };
                self.step = Step::Waiting { authorization };
                effect
            }
            Step::OtherId(mut field) => match field.handle_key(key) {
                TextOutcome::Pending => {
                    self.step = Step::OtherId(field);
                    Effect::None
                }
                TextOutcome::Cancelled => Effect::Close,
                TextOutcome::Submitted(id) if valid_provider_id(&id) => {
                    self.step = Self::api_key_step(
                        Provider {
                            name: id.clone(),
                            id,
                        },
                        HashMap::new(),
                    );
                    Effect::None
                }
                TextOutcome::Submitted(_) => {
                    self.step = Step::OtherId(
                        TextDialog::new("Provider id · lowercase letters, digits and hyphens", "")
                            .placeholder("deepseek"),
                    );
                    Effect::None
                }
            },
            Step::Working(message) => {
                self.step = Step::Working(message);
                if key.code == KeyCode::Esc {
                    Effect::Close
                } else {
                    Effect::None
                }
            }
        }
    }

    fn choose_provider(&mut self, provider: Provider) -> Effect {
        let methods = self.auth.get(&provider.id).cloned().unwrap_or_else(|| {
            vec![AuthMethod {
                oauth: false,
                label: "API key".to_owned(),
                prompts: Vec::new(),
            }]
        });
        if methods.len() == 1 {
            let definition = methods[0].clone();
            return self.begin(provider, 0, definition);
        }
        let entries = methods
            .iter()
            .enumerate()
            .map(|(i, m)| Entry::new(m.label.clone(), "", i))
            .collect();
        self.step = Step::Methods {
            picker: Picker::new(format!("{} · sign in with", provider.name), entries),
            provider,
            methods,
        };
        Effect::None
    }

    pub fn render(&self, frame: &mut Frame<'_>, area: Rect, theme: &Theme) {
        match &self.step {
            Step::Providers(picker) => picker.render(frame, area, theme),
            Step::Methods { picker, .. } => picker.render(frame, area, theme),
            Step::Asking {
                ask: Ask::Text(dialog),
                ..
            } => dialog.render(frame, area, theme),
            Step::Asking {
                ask: Ask::Select(picker),
                ..
            } => picker.render(frame, area, theme),
            Step::Key { field, .. } | Step::Code { field, .. } | Step::OtherId(field) => {
                field.render(frame, area, theme)
            }
            Step::Working(message) => card(
                frame,
                area,
                "connect",
                vec![Line::from(Span::styled(*message, theme.dim()))],
                theme,
            ),
            Step::Waiting { authorization } => {
                let mut lines = vec![
                    Line::from(Span::raw(authorization.instructions.clone())),
                    Line::default(),
                ];
                lines.extend(wrap_chars(&authorization.url, 66).into_iter().map(|row| {
                    Line::from(
                        Span::styled(row, Style::new().fg(theme.accent).underline())
                            .link(authorization.url.clone()),
                    )
                }));
                lines.push(Line::default());
                lines.push(Line::from(Span::styled(
                    "Waiting for you to finish in the browser…",
                    theme.dim(),
                )));
                lines.push(Line::from(vec![
                    Span::styled("c", theme.key()),
                    Span::styled(" copy   ", theme.dim()),
                    Span::styled("o", theme.key()),
                    Span::styled(" open   ", theme.dim()),
                    Span::styled("esc", theme.key()),
                    Span::styled(" cancel", theme.dim()),
                ]));
                card(frame, area, "sign in", lines, theme);
            }
        }
    }
}

fn card(frame: &mut Frame<'_>, area: Rect, title: &str, lines: Vec<Line<'static>>, theme: &Theme) {
    let popup = area.centered(72, lines.len() as u16 + 2);
    frame.render_widget(Clear, popup);
    frame.render_widget(
        Paragraph::new(Text::from(lines)).block(
            Block::bordered()
                .border_type(BorderType::Rounded)
                .border_style(Style::new().fg(theme.accent))
                .title(Line::from(Span::styled(
                    format!(" {title} "),
                    Style::new().fg(theme.accent).bold(),
                )))
                .padding(Edges::symmetric(0, 1)),
        ),
        popup,
    );
}

#[cfg(test)]
mod tests {
    use crewtui::KeyModifiers;

    use super::*;

    fn press(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    fn typed(connect: &mut Connect, text: &str) {
        text.chars().for_each(|c| {
            connect.handle_key(press(KeyCode::Char(c)));
        });
    }

    fn provider(id: &str, name: &str, connected: bool) -> ProviderInfo {
        ProviderInfo {
            id: id.to_owned(),
            name: name.to_owned(),
            connected,
        }
    }

    fn method(oauth: bool, label: &str) -> AuthMethod {
        AuthMethod {
            oauth,
            label: label.to_owned(),
            prompts: Vec::new(),
        }
    }

    fn api_only() -> Connect {
        Connect::new(
            vec![
                provider("zeta", "Zeta", false),
                provider("openrouter", "OpenRouter", true),
                provider("alpha", "Alpha", false),
            ],
            HashMap::new(),
        )
    }

    #[test]
    fn popular_providers_come_first_and_the_rest_by_name() {
        let connect = api_only();
        let Step::Providers(picker) = &connect.step else {
            panic!("expected the provider list")
        };
        let names: Vec<_> = picker.visible().iter().map(|e| e.label.clone()).collect();
        assert_eq!(names, ["OpenRouter", "Alpha", "Zeta", "Other provider…"]);
    }

    #[test]
    fn a_provider_with_only_an_api_key_goes_straight_to_the_key_and_saves_it() {
        let mut connect = api_only();
        typed(&mut connect, "alpha");
        assert_eq!(connect.handle_key(press(KeyCode::Enter)), Effect::None);
        assert!(matches!(connect.step, Step::Key { .. }));
        typed(&mut connect, "sk-1");
        let effect = connect.handle_key(press(KeyCode::Enter));
        assert_eq!(
            effect,
            Effect::SaveKey {
                provider: Provider {
                    id: "alpha".to_owned(),
                    name: "Alpha".to_owned()
                },
                key: "sk-1".to_owned(),
                metadata: HashMap::new()
            }
        );
    }

    #[test]
    fn several_methods_ask_which_one_to_use() {
        let auth = HashMap::from([(
            "acme".to_owned(),
            vec![method(false, "API key"), method(true, "Browser login")],
        )]);
        let mut connect = Connect::new(vec![provider("acme", "Acme", false)], auth);
        connect.handle_key(press(KeyCode::Enter));
        assert!(matches!(connect.step, Step::Methods { .. }));
        connect.handle_key(press(KeyCode::Down));
        let effect = connect.handle_key(press(KeyCode::Enter));
        assert!(
            matches!(effect, Effect::Authorize { method: 1, .. }),
            "{effect:?}"
        );
    }

    #[test]
    fn questions_are_asked_in_order_and_skipped_when_their_condition_fails() {
        let region = AuthPrompt {
            key: "region".into(),
            message: "Region".into(),
            placeholder: String::new(),
            options: vec![
                ("EU".into(), "eu".into(), String::new()),
                ("US".into(), "us".into(), String::new()),
            ],
            condition: None,
        };
        let tenant = AuthPrompt {
            key: "tenant".into(),
            message: "Tenant".into(),
            placeholder: String::new(),
            options: Vec::new(),
            condition: Some(crate::client::AuthCondition {
                key: "region".into(),
                value: "us".into(),
                negated: true,
            }),
        };
        let login = AuthMethod {
            oauth: true,
            label: "Login".into(),
            prompts: vec![region, tenant],
        };
        let auth = HashMap::from([(
            "acme".to_owned(),
            vec![login.clone(), method(false, "API key")],
        )]);
        let mut connect = Connect::new(vec![provider("acme", "Acme", false)], auth);
        connect.handle_key(press(KeyCode::Enter));
        connect.handle_key(press(KeyCode::Enter));
        assert!(matches!(connect.step, Step::Asking { .. }));
        connect.handle_key(press(KeyCode::Down));
        let effect = connect.handle_key(press(KeyCode::Enter));
        let Effect::Authorize { inputs, .. } = effect else {
            panic!("the tenant question should have been skipped for the US")
        };
        assert_eq!(
            inputs,
            HashMap::from([("region".to_owned(), "us".to_owned())])
        );
    }

    #[test]
    fn a_pasted_code_finishes_a_manual_login() {
        let mut connect = api_only();
        let provider = Provider {
            id: "acme".to_owned(),
            name: "Acme".to_owned(),
        };
        let authorization = Authorization {
            url: "https://login.example/x".to_owned(),
            automatic: false,
            instructions: "Paste the code".to_owned(),
        };
        assert_eq!(
            connect.authorized(provider.clone(), 1, Ok(authorization)),
            Effect::Open("https://login.example/x".to_owned())
        );
        typed(&mut connect, "abc123");
        assert_eq!(
            connect.handle_key(press(KeyCode::Enter)),
            Effect::Callback {
                provider,
                method: 1,
                code: Some("abc123".to_owned())
            }
        );
    }

    #[test]
    fn an_automatic_login_waits_and_can_copy_the_device_code() {
        let mut connect = api_only();
        let provider = Provider {
            id: "acme".to_owned(),
            name: "Acme".to_owned(),
        };
        let authorization = Authorization {
            url: "https://login.example/device".to_owned(),
            automatic: true,
            instructions: "Enter code: ABCD-12345".to_owned(),
        };
        connect.authorized(provider, 0, Ok(authorization));
        assert_eq!(
            connect.handle_key(press(KeyCode::Char('c'))),
            Effect::Copy("ABCD-12345".to_owned())
        );
        assert_eq!(
            connect.handle_key(press(KeyCode::Char('o'))),
            Effect::Open("https://login.example/device".to_owned())
        );
        assert_eq!(connect.handle_key(press(KeyCode::Esc)), Effect::Close);
    }

    #[test]
    fn another_provider_is_reached_by_a_valid_id_only() {
        let mut connect = api_only();
        typed(&mut connect, "other");
        connect.handle_key(press(KeyCode::Enter));
        typed(&mut connect, "Bad Id");
        connect.handle_key(press(KeyCode::Enter));
        assert!(
            matches!(connect.step, Step::OtherId(_)),
            "an invalid id asks again"
        );
        typed(&mut connect, "deep-seek2");
        connect.handle_key(press(KeyCode::Enter));
        let Step::Key { provider, .. } = &connect.step else {
            panic!("expected the key step")
        };
        assert_eq!(provider.id, "deep-seek2");
    }

    #[test]
    fn escape_closes_from_any_step() {
        let mut connect = api_only();
        assert_eq!(connect.handle_key(press(KeyCode::Esc)), Effect::Close);
    }

    #[test]
    fn long_links_are_cut_into_rows_that_can_still_be_copied() {
        assert_eq!(wrap_chars("abcdefg", 3), ["abc", "def", "g"]);
        assert_eq!(wrap_chars("", 3).len(), 0);
    }
}
