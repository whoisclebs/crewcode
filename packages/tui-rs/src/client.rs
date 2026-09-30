//! A blocking HTTP client for the CrewCode server.
//!
//! Requests run on CrewTUI's worker threads, so nothing here needs an async
//! runtime. The server address comes from `CREWCODE_URL` and the optional
//! basic-auth pair from `CREWCODE_SERVER_USERNAME` and `CREWCODE_SERVER_PASSWORD`,
//! the same variables the server reads.

use std::io::{BufRead, BufReader};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::Deserialize;
use serde_json::Value;

/// Connection settings for one server.
#[derive(Debug, Clone)]
pub struct Client {
    base_url: String,
    authorization: Option<String>,
    directory: String,
}

/// The fields of a session that the session list shows.
#[derive(Debug, Clone, Deserialize)]
pub struct Session {
    pub id: String,
    /// The session that started this one, for a subagent's.
    #[serde(default, rename = "parentID")]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub time: SessionTime,
}

/// A provider the server knows.
#[derive(Debug, Clone)]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub connected: bool,
}

/// A question a login method asks before it can start, such as which region to use.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthPrompt {
    pub key: String,
    pub message: String,
    pub placeholder: String,
    /// Empty for a free-text question; otherwise the choices as label, value and hint.
    pub options: Vec<(String, String, String)>,
    /// Asked only when an earlier answer `key` equals (or, when `negated`, differs from) `value`.
    pub condition: Option<AuthCondition>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthCondition {
    pub key: String,
    pub value: String,
    pub negated: bool,
}

/// One way to connect a provider: an API key, or a login in the browser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthMethod {
    pub oauth: bool,
    pub label: String,
    pub prompts: Vec<AuthPrompt>,
}

/// What the user must do to finish a browser login.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Authorization {
    pub url: String,
    /// `code` when the user pastes a code back, `auto` when the server waits for the browser to finish.
    pub automatic: bool,
    pub instructions: String,
}

/// The auth methods of every provider that has more than an API key, as the server lists them.
pub fn parse_auth_methods(value: &Value) -> std::collections::HashMap<String, Vec<AuthMethod>> {
    let text = |v: &Value, key: &str| v[key].as_str().unwrap_or_default().to_owned();
    value
        .as_object()
        .into_iter()
        .flatten()
        .map(|(provider, methods)| {
            let methods = methods
                .as_array()
                .into_iter()
                .flatten()
                .map(|m| AuthMethod {
                    oauth: m["type"] == "oauth",
                    label: text(m, "label"),
                    prompts: m["prompts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|p| AuthPrompt {
                            key: text(p, "key"),
                            message: text(p, "message"),
                            placeholder: text(p, "placeholder"),
                            options: p["options"]
                                .as_array()
                                .into_iter()
                                .flatten()
                                .map(|o| (text(o, "label"), text(o, "value"), text(o, "hint")))
                                .collect(),
                            condition: p["when"].as_object().map(|_| AuthCondition {
                                key: text(&p["when"], "key"),
                                value: text(&p["when"], "value"),
                                negated: p["when"]["op"] == "neq",
                            }),
                        })
                        .collect(),
                })
                .collect();
            (provider.clone(), methods)
        })
        .collect()
}

/// A message on its way to the server.
#[derive(Debug, Clone, Default)]
pub struct Outgoing {
    /// What the user typed, shown in the conversation.
    pub text: String,
    /// Instructions for the model that the conversation does not show, such as the bodies of skills.
    pub hidden: Vec<String>,
    /// Project files, relative to the working directory, attached to the message.
    pub files: Vec<String>,
}

/// `text` escaped for use in a URL query.
fn encode_query(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// A provider and model id, as the server addresses a model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModelSelection {
    pub provider_id: String,
    pub model_id: String,
}

impl ModelSelection {
    /// Parses `provider/model`, where the model id may itself contain slashes.
    pub fn parse(qualified: &str) -> Option<Self> {
        let (provider_id, model_id) = qualified.split_once('/')?;
        Some(Self {
            provider_id: provider_id.to_owned(),
            model_id: model_id.to_owned(),
        })
    }

    /// `provider/model`.
    pub fn qualified(&self) -> String {
        format!("{}/{}", self.provider_id, self.model_id)
    }
}

/// What the user picked for the next prompts; unset fields use the server's defaults.
#[derive(Debug, Clone, Default)]
pub struct Choice {
    pub model: Option<ModelSelection>,
    pub agent: Option<String>,
    /// How hard the model thinks, such as `high`; named by the model, unset for its default.
    pub variant: Option<String>,
}

/// One model offered by a connected provider.
#[derive(Debug, Clone)]
pub struct ModelChoice {
    pub provider_id: String,
    pub provider_name: String,
    pub model_id: String,
    pub name: String,
    /// The most tokens the model takes as context; 0 when the server does not say.
    pub context_limit: u64,
    /// The thinking levels the model offers, such as `low` and `high`.
    pub variants: Vec<String>,
}

/// One agent the user can switch to.
#[derive(Debug, Clone)]
pub struct AgentChoice {
    pub name: String,
    pub description: String,
}

/// One slash command.
#[derive(Debug, Clone)]
pub struct CommandChoice {
    pub name: String,
    pub description: String,
    /// Where the command comes from: `command`, `mcp` or `skill`.
    pub source: String,
    /// The instructions the command expands to; `$ARGUMENTS` stands for what the user typed after it.
    pub template: String,
}

/// One item of a session's todo list.
#[derive(Debug, Clone, Deserialize)]
pub struct Todo {
    pub content: String,
    pub status: String,
}

/// Millisecond timestamps of a session.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionTime {
    #[serde(default)]
    pub updated: u64,
}

/// A message and its parts, as `GET /session/{id}/message` returns it.
#[derive(Debug, Clone, Deserialize)]
pub struct StoredMessage {
    pub info: Value,
    pub parts: Vec<Value>,
}

/// One frame from the global event stream.
#[derive(Debug, Clone, Deserialize)]
pub struct GlobalEvent {
    pub payload: Value,
}

impl GlobalEvent {
    /// The event type, such as `session.updated`.
    pub fn kind(&self) -> &str {
        self.payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    }

    /// The event's `properties` object.
    pub fn properties(&self) -> &Value {
        &self.payload["properties"]
    }
}

impl Client {
    /// A client for the server at `base_url`, with no credentials.
    #[cfg(test)]
    pub fn new(base_url: &str, directory: &str) -> Self {
        Self {
            base_url: base_url.to_owned(),
            authorization: None,
            directory: directory.to_owned(),
        }
    }

    /// Points the client at a server that is already running. The credentials still come from the environment.
    pub fn with_url(mut self, url: &str) -> Self {
        self.base_url = url.trim_end_matches('/').to_owned();
        self
    }

    /// Reads the connection settings from the environment.
    pub fn from_env(directory: String) -> Self {
        let base_url = std::env::var("CREWCODE_URL")
            .unwrap_or_else(|_| "http://127.0.0.1:4096".to_owned())
            .trim_end_matches('/')
            .to_owned();
        let authorization = std::env::var("CREWCODE_SERVER_PASSWORD")
            .ok()
            .filter(|password| !password.is_empty())
            .map(|password| {
                let username = std::env::var("CREWCODE_SERVER_USERNAME")
                    .unwrap_or_else(|_| "crewcode".to_owned());
                format!(
                    "Basic {}",
                    STANDARD.encode(format!("{username}:{password}"))
                )
            });
        Self {
            base_url,
            authorization,
            directory,
        }
    }

    /// Points the client at a server this process started, with the password only this process knows.
    pub fn with_server(mut self, url: &str, password: &str) -> Self {
        self.base_url = url.trim_end_matches('/').to_owned();
        self.authorization = Some(format!(
            "Basic {}",
            STANDARD.encode(format!("crewcode:{password}"))
        ));
        self
    }

    /// The directory this session works in, as given.
    pub fn raw_directory(&self) -> String {
        self.directory.clone()
    }

    /// The directory this session works in, with the home directory as `~`.
    pub fn directory(&self) -> String {
        match std::env::var("HOME") {
            Ok(home) if self.directory.starts_with(&home) => self.directory.replacen(&home, "~", 1),
            _ => self.directory.clone(),
        }
    }

    fn authorize<B>(&self, mut request: ureq::RequestBuilder<B>) -> ureq::RequestBuilder<B> {
        request = request.header("x-crewcode-directory", &self.directory);
        if let Some(authorization) = &self.authorization {
            request = request.header("Authorization", authorization);
        }
        request
    }

    fn post(&self, path: &str, body: &Value) -> Result<(), String> {
        self.authorize(ureq::post(format!("{}{path}", self.base_url)))
            .send_json(body)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Creates an empty session and returns its id.
    pub fn create_session(&self) -> Result<String, String> {
        let mut response = self
            .authorize(ureq::post(format!("{}/session", self.base_url)))
            .send_json(serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        let session: Session = response.body_mut().read_json().map_err(|e| e.to_string())?;
        Ok(session.id)
    }

    /// Sends a message; the answer arrives on the event stream.
    pub fn prompt(&self, session: &str, message: &Outgoing, choice: &Choice) -> Result<(), String> {
        let hidden = message
            .hidden
            .iter()
            .map(|instructions| serde_json::json!({ "type": "text", "text": instructions, "synthetic": true }));
        let files = message.files.iter().map(|path| {
            serde_json::json!({
                "type": "file",
                "mime": "text/plain",
                "filename": path,
                "url": format!("file://{}/{path}", self.directory),
            })
        });
        let text = std::iter::once(serde_json::json!({ "type": "text", "text": message.text }));
        let parts: Vec<Value> = hidden.chain(files).chain(text).collect();
        let mut body = serde_json::json!({ "parts": parts });
        if let Some(model) = &choice.model {
            body["model"] =
                serde_json::json!({ "providerID": model.provider_id, "modelID": model.model_id });
        }
        if let Some(agent) = &choice.agent {
            body["agent"] = Value::String(agent.clone());
        }
        if let Some(variant) = &choice.variant {
            body["variant"] = Value::String(variant.clone());
        }
        self.post(&format!("/session/{session}/prompt_async"), &body)
    }

    /// Every provider the server lists, with whether it is connected.
    pub fn providers(&self) -> Result<Vec<ProviderInfo>, String> {
        let listing = self.get_json("/provider")?;
        let connected: Vec<&str> = listing["connected"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        Ok(listing["all"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| {
                let id = p["id"].as_str().unwrap_or_default().to_owned();
                ProviderInfo {
                    name: p["name"].as_str().unwrap_or(&id).to_owned(),
                    connected: connected.contains(&id.as_str()),
                    id,
                }
            })
            .collect())
    }

    /// The login methods of the providers that offer more than an API key.
    pub fn provider_auth(
        &self,
    ) -> Result<std::collections::HashMap<String, Vec<AuthMethod>>, String> {
        Ok(parse_auth_methods(&self.get_json("/provider/auth")?))
    }

    /// Stores an API key for a provider, then makes the server pick it up.
    pub fn save_api_key(
        &self,
        provider: &str,
        key: &str,
        metadata: &std::collections::HashMap<String, String>,
    ) -> Result<(), String> {
        let mut auth = serde_json::json!({ "type": "api", "key": key });
        if !metadata.is_empty() {
            auth["metadata"] = serde_json::json!(metadata);
        }
        self.send_json("PUT", &format!("/auth/{provider}"), &auth)?;
        self.dispose()
    }

    /// Starts a browser login and returns where to go and what to do there.
    pub fn oauth_authorize(
        &self,
        provider: &str,
        method: usize,
        inputs: &std::collections::HashMap<String, String>,
    ) -> Result<Authorization, String> {
        let mut body = serde_json::json!({ "method": method });
        if !inputs.is_empty() {
            body["inputs"] = serde_json::json!(inputs);
        }
        let answer = self.send_json(
            "POST",
            &format!("/provider/{provider}/oauth/authorize"),
            &body,
        )?;
        Ok(Authorization {
            url: answer["url"].as_str().unwrap_or_default().to_owned(),
            automatic: answer["method"] == "auto",
            instructions: answer["instructions"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        })
    }

    /// Finishes a browser login: with the code the user pasted, or, for an automatic one, by waiting for the browser.
    pub fn oauth_callback(
        &self,
        provider: &str,
        method: usize,
        code: Option<&str>,
    ) -> Result<(), String> {
        let mut body = serde_json::json!({ "method": method });
        if let Some(code) = code {
            body["code"] = Value::String(code.to_owned());
        }
        self.send_json(
            "POST",
            &format!("/provider/{provider}/oauth/callback"),
            &body,
        )?;
        self.dispose()
    }

    /// Makes the server reload its providers after a credential changed.
    fn dispose(&self) -> Result<(), String> {
        self.send_json("POST", "/instance/dispose", &serde_json::json!({}))
            .map(drop)
    }

    /// Project files whose path matches `query`, best match first.
    pub fn find_files(&self, query: &str) -> Result<Vec<String>, String> {
        self.get(&format!("/find/file?limit=8&query={}", encode_query(query)))
            .call()
            .and_then(|mut response| response.body_mut().read_json())
            .map_err(|e| e.to_string())
    }

    /// Stops the answer being generated.
    pub fn abort(&self, session: &str) -> Result<(), String> {
        self.post(&format!("/session/{session}/abort"), &serde_json::json!({}))
    }

    /// Answers a permission request with `once`, `always` or `reject`.
    pub fn reply_permission(&self, request: &str, reply: &str) -> Result<(), String> {
        self.post(
            &format!("/permission/{request}/reply"),
            &serde_json::json!({ "reply": reply }),
        )
    }

    fn send_json(&self, method: &str, path: &str, body: &Value) -> Result<Value, String> {
        let url = format!("{}{path}", self.base_url);
        let request = match method {
            "PATCH" => ureq::patch(url),
            "PUT" => ureq::put(url),
            _ => ureq::post(url),
        };
        let mut response = self
            .authorize(request)
            .send_json(body)
            .map_err(|e| e.to_string())?;
        response.body_mut().read_json().map_err(|e| e.to_string())
    }

    fn get_json(&self, path: &str) -> Result<Value, String> {
        self.get(path)
            .call()
            .and_then(|mut response| response.body_mut().read_json())
            .map_err(|e| e.to_string())
    }

    /// The models of every connected provider, plus the configured default as `provider/model`.
    pub fn models(&self) -> Result<(Vec<ModelChoice>, Option<String>), String> {
        let providers = self.get_json("/config/providers")?;
        let default = self
            .get_json("/config")
            .ok()
            .and_then(|c| c["model"].as_str().map(str::to_owned));
        let choices = providers["providers"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|provider| {
                let provider_id = provider["id"].as_str().unwrap_or_default().to_owned();
                let provider_name = provider["name"].as_str().unwrap_or(&provider_id).to_owned();
                provider["models"]
                    .as_object()
                    .into_iter()
                    .flat_map(move |models| {
                        models
                            .values()
                            .map({
                                let (provider_id, provider_name) =
                                    (provider_id.clone(), provider_name.clone());
                                move |model| ModelChoice {
                                    provider_id: provider_id.clone(),
                                    provider_name: provider_name.clone(),
                                    model_id: model["id"].as_str().unwrap_or_default().to_owned(),
                                    name: model["name"].as_str().unwrap_or_default().to_owned(),
                                    context_limit: model["limit"]["context"]
                                        .as_u64()
                                        .unwrap_or_default(),
                                    variants: model["variants"]
                                        .as_object()
                                        .map(|v| v.keys().cloned().collect())
                                        .unwrap_or_default(),
                                }
                            })
                            .collect::<Vec<_>>()
                    })
            })
            .collect();
        Ok((choices, default))
    }

    /// The primary agents the user can switch between.
    pub fn agents(&self) -> Result<Vec<AgentChoice>, String> {
        let agents = self.get_json("/agent")?;
        Ok(agents
            .as_array()
            .into_iter()
            .flatten()
            .filter(|a| a["mode"] != "subagent" && a["hidden"] != true)
            .map(|a| AgentChoice {
                name: a["name"].as_str().unwrap_or_default().to_owned(),
                description: a["description"].as_str().unwrap_or_default().to_owned(),
            })
            .collect())
    }

    /// The slash commands the server offers.
    pub fn commands(&self) -> Result<Vec<CommandChoice>, String> {
        let commands = self.get_json("/command")?;
        Ok(commands
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| CommandChoice {
                name: c["name"].as_str().unwrap_or_default().to_owned(),
                description: c["description"].as_str().unwrap_or_default().to_owned(),
                source: c["source"].as_str().unwrap_or("command").to_owned(),
                template: c["template"].as_str().unwrap_or_default().to_owned(),
            })
            .collect())
    }

    /// The git branch of the working directory, when it is in a repository.
    pub fn branch(&self) -> Option<String> {
        self.get_json("/vcs").ok()?["branch"]
            .as_str()
            .map(str::to_owned)
    }

    /// The connection status of each MCP server, by name.
    pub fn mcp_servers(&self) -> Result<Vec<(String, String)>, String> {
        let servers = self.get_json("/mcp")?;
        Ok(servers
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, info)| {
                (
                    name.clone(),
                    info["status"].as_str().unwrap_or("unknown").to_owned(),
                )
            })
            .collect())
    }

    /// One session, with its title.
    pub fn session(&self, id: &str) -> Result<Session, String> {
        serde_json::from_value(self.get_json(&format!("/session/{id}"))?).map_err(|e| e.to_string())
    }

    /// The session of this directory changed last, leaving out the ones a subagent ran.
    pub fn latest_session(&self) -> Result<Option<Session>, String> {
        Ok(self.sessions()?.into_iter().find(|s| s.parent_id.is_none()))
    }

    /// Connects or disconnects an MCP server.
    pub fn set_mcp_connected(&self, name: &str, connected: bool) -> Result<(), String> {
        let action = if connected { "connect" } else { "disconnect" };
        self.send_json(
            "POST",
            &format!("/mcp/{name}/{action}"),
            &serde_json::json!({}),
        )
        .map(drop)
    }

    /// The sessions that subagents of `session` ran.
    pub fn children(&self, session: &str) -> Result<Vec<Session>, String> {
        serde_json::from_value(self.get_json(&format!("/session/{session}/children"))?)
            .map_err(|e| e.to_string())
    }

    /// The todo list of a session.
    pub fn todos(&self, session: &str) -> Result<Vec<Todo>, String> {
        serde_json::from_value(self.get_json(&format!("/session/{session}/todo"))?)
            .map_err(|e| e.to_string())
    }

    /// Renames a session.
    pub fn rename_session(&self, session: &str, title: &str) -> Result<(), String> {
        self.send_json(
            "PATCH",
            &format!("/session/{session}"),
            &serde_json::json!({ "title": title }),
        )
        .map(drop)
    }

    /// Deletes a session.
    pub fn delete_session(&self, session: &str) -> Result<(), String> {
        self.authorize(ureq::delete(format!("{}/session/{session}", self.base_url)))
            .call()
            .map(drop)
            .map_err(|e| e.to_string())
    }

    /// Copies a session up to its latest message and returns the copy's id.
    pub fn fork_session(&self, session: &str) -> Result<String, String> {
        let forked = self.send_json(
            "POST",
            &format!("/session/{session}/fork"),
            &serde_json::json!({}),
        )?;
        forked["id"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "the server returned no session".to_owned())
    }

    /// Summarizes a session's history to free context.
    pub fn compact(&self, session: &str, model: &ModelSelection) -> Result<(), String> {
        self.send_json(
            "POST",
            &format!("/session/{session}/summarize"),
            &serde_json::json!({ "providerID": model.provider_id, "modelID": model.model_id }),
        )
        .map(drop)
    }

    /// Runs a slash command in a session.
    pub fn run_command(&self, session: &str, command: &str, arguments: &str) -> Result<(), String> {
        self.send_json(
            "POST",
            &format!("/session/{session}/command"),
            &serde_json::json!({ "command": command, "arguments": arguments }),
        )
        .map(drop)
    }

    /// Answers a question request; one list of chosen labels per question.
    pub fn reply_question(&self, request: &str, answers: &[Vec<String>]) -> Result<(), String> {
        self.post(
            &format!("/question/{request}/reply"),
            &serde_json::json!({ "answers": answers }),
        )
    }

    /// Dismisses a question request without answering.
    pub fn reject_question(&self, request: &str) -> Result<(), String> {
        self.post(
            &format!("/question/{request}/reject"),
            &serde_json::json!({}),
        )
    }

    /// How actions that need approval are handled: `manual`, `auto` or `observe`.
    pub fn permission_mode(&self) -> Result<String, String> {
        Ok(self.get_json("/permission/mode")?["mode"]
            .as_str()
            .unwrap_or("manual")
            .to_owned())
    }

    /// Changes how actions that need approval are handled.
    pub fn set_permission_mode(&self, mode: &str) -> Result<(), String> {
        self.send_json(
            "PUT",
            "/permission/mode",
            &serde_json::json!({ "mode": mode }),
        )
        .map(drop)
    }

    /// The messages of a session, oldest first.
    pub fn messages(&self, session: &str) -> Result<Vec<StoredMessage>, String> {
        self.get(&format!("/session/{session}/message"))
            .call()
            .and_then(|mut response| response.body_mut().read_json())
            .map_err(|e| e.to_string())
    }

    fn get(&self, path: &str) -> ureq::RequestBuilder<ureq::typestate::WithoutBody> {
        self.authorize(ureq::get(format!("{}{path}", self.base_url)))
    }

    /// Fails unless the server answers its health check.
    pub fn health(&self) -> Result<(), String> {
        self.get("/global/health")
            .call()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    /// Lists the sessions of the current directory's project.
    pub fn sessions(&self) -> Result<Vec<Session>, String> {
        self.get("/session")
            .call()
            .and_then(|mut response| response.body_mut().read_json())
            .map_err(|e| e.to_string())
    }

    /// Follows `/global/event`, calling `on_event` for each frame until the
    /// stream ends or `on_event` returns `false`.
    pub fn follow_events(
        &self,
        mut on_event: impl FnMut(GlobalEvent) -> bool,
    ) -> Result<(), String> {
        let response = self
            .get("/global/event")
            .call()
            .map_err(|e| e.to_string())?;
        let reader = BufReader::new(response.into_body().into_reader());
        for line in reader.lines() {
            let line = line.map_err(|e| e.to_string())?;
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            if let Ok(event) = serde_json::from_str::<GlobalEvent>(data.trim()) {
                if !on_event(event) {
                    return Ok(());
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_methods_keep_their_prompts_and_conditions() {
        let listing = serde_json::json!({"acme": [
            {"type": "api", "label": "API key"},
            {"type": "oauth", "label": "Browser", "prompts": [
                {"type": "select", "key": "region", "message": "Region", "options": [{"label": "EU", "value": "eu", "hint": "Europe"}]},
                {"type": "text", "key": "tenant", "message": "Tenant", "placeholder": "acme",
                 "when": {"key": "region", "op": "neq", "value": "us"}}]}]});
        let methods = &parse_auth_methods(&listing)["acme"];
        assert!(!methods[0].oauth && methods[1].oauth);
        assert_eq!(
            methods[1].prompts[0].options,
            [("EU".to_owned(), "eu".to_owned(), "Europe".to_owned())]
        );
        let condition = methods[1].prompts[1].condition.clone().unwrap();
        assert_eq!(
            (
                condition.key.as_str(),
                condition.value.as_str(),
                condition.negated
            ),
            ("region", "us", true)
        );
    }

    #[test]
    fn queries_are_escaped_for_a_url() {
        assert_eq!(encode_query("src/main.rs"), "src%2Fmain.rs");
        assert_eq!(encode_query("a b"), "a%20b");
        assert_eq!(encode_query("ok-1_2.~"), "ok-1_2.~");
    }

    #[test]
    fn a_model_selection_round_trips_through_its_qualified_name() {
        let selection = ModelSelection::parse("openrouter/anthropic/claude").unwrap();
        assert_eq!(selection.provider_id, "openrouter");
        assert_eq!(selection.model_id, "anthropic/claude");
        assert_eq!(selection.qualified(), "openrouter/anthropic/claude");
        assert!(ModelSelection::parse("nomodel").is_none());
    }
}
