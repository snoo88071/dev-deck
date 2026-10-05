//! What a Claude Code session is working on: one or two sentences written by
//! `claude -p` (Haiku, minimal context, no saved session) from the transcript's
//! tail. Cached in `~/.dev-deck/sessions.json`, tied to the transcript's
//! fingerprint: until it changes, no new call.

use crate::sessions::{read_tail, Session};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Description {
    pub text: String,
    /// When it was written (Unix seconds).
    pub at: u64,
    /// The transcript's fingerprint when it was written: size and last modification.
    pub fingerprint: String,
}

pub fn fingerprint(s: &Session) -> Option<String> {
    Some(format!("{}:{}", s.transcript_size?, s.last_activity?))
}

pub fn dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
    Path::new(&home).join(".dev-deck")
}

fn cache_path() -> PathBuf {
    if let Ok(p) = std::env::var("DEVDECK_SESSIONS") {
        return p.into();
    }
    let dir = dir();
    migrate_cache(&dir);
    dir.join("sessions.json")
}

/// Older versions called the cache `sessioni.json`: same content, new name.
fn migrate_cache(dir: &Path) {
    let old = dir.join("sessioni.json");
    let new = dir.join("sessions.json");
    if old.exists() && !new.exists() {
        let _ = std::fs::rename(old, new);
    }
}

/* ---------- the opt-in: descriptions send transcript tails to claude -p and cost tokens ---------- */

fn config_path() -> PathBuf {
    dir().join("config.json")
}

/// `DEVDECK_DESCRIBE=1|0` (also true/false, on/off); anything else doesn't count.
fn env_switch(env: Option<&str>) -> Option<bool> {
    match env?.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "on" => Some(true),
        "0" | "false" | "off" => Some(false),
        _ => None,
    }
}

/// `DEVDECK_DESCRIBE` wins over `config.json`, which wins over the default: off.
fn enabled_from(env: Option<&str>, config: Option<&str>) -> bool {
    env_switch(env).unwrap_or_else(|| {
        config
            .and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok())
            .and_then(|v| v["describe_sessions"].as_bool())
            .unwrap_or(false)
    })
}

/// Whether sessions may be described, and whether `DEVDECK_DESCRIBE` decides it (the panel can't).
pub fn settings() -> (bool, bool) {
    let env = std::env::var("DEVDECK_DESCRIBE").ok();
    let config = std::fs::read_to_string(config_path()).ok();
    (enabled_from(env.as_deref(), config.as_deref()), env_switch(env.as_deref()).is_some())
}

pub fn enabled() -> bool {
    settings().0
}

/// Turns descriptions on or off in `config.json`, keeping any other key.
pub fn set_enabled(on: bool) -> Result<(), String> {
    let path = config_path();
    let mut config = std::fs::read_to_string(&path)
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .filter(|v| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));
    config["describe_sessions"] = serde_json::json!(on);
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    std::fs::write(&path, serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

pub fn read_cache() -> HashMap<String, Description> {
    std::fs::read_to_string(cache_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn write_cache(cache: &HashMap<String, Description>) -> Result<(), String> {
    let path = cache_path();
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    // Written alongside and then renamed: a concurrent reader never finds a half-written file.
    let tmp = path.with_extension(format!("json.{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(cache).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// The instructions for `claude -p`, asking for the app's language (the Windows one, see locale.rs).
pub fn system_prompt(language: &str) -> String {
    format!(
        "Here is the final part of a conversation between a person and Claude Code (a coding assistant), in a session opened in a folder. \
In one or two sentences in {language}, say what is being worked on right now and how far along it is; \
when something is left to do, the second sentence says only that (the panel shows it on its own line). \
Start with the work itself, never with an impersonal or passive opening (not \"It is being...\", not the Italian \"Si sta...\"), and stay under 30 words. \
For example (in English): \"Claude Code sessions in the panel: the Rust side is done. The UI is still missing.\" \
Write without names of people and without gendered pronouns or adjectives for the person. Only the sentences, no preamble, no lists."
    )
}

/// The text for `claude -p`: folder, title, last prompt and the last messages, shortened.
pub fn prompt_for(s: &Session, messages: &[(String, String)]) -> String {
    let mut out = format!(
        "Folder: {}\nSession title (from the start, may be outdated): {}\nThe person's last prompt: {}\n\nLast messages:\n",
        s.cwd.as_deref().unwrap_or("?"),
        s.title.as_deref().unwrap_or("-"),
        s.last_prompt.as_deref().unwrap_or("-"),
    );
    let mut budget = 10_000usize;
    let mut lines = vec![];
    for (role, text) in messages.iter().rev() {
        let who = if role == "user" { "Person" } else { "Claude" };
        let t: String = text.chars().take(600).collect();
        let line = format!("{who}: {t}\n");
        if line.len() > budget {
            break;
        }
        budget -= line.len();
        lines.push(line);
    }
    lines.reverse();
    out.push_str(&lines.concat());
    out
}

fn ask_claude(prompt: &str) -> Result<String, String> {
    let bin = std::env::var("CLAUDE_BIN").unwrap_or_else(|_| "claude".into());
    let cwd = dir().join("claude-p");
    std::fs::create_dir_all(&cwd).map_err(|e| e.to_string())?;
    let mut cmd = Command::new(&bin);
    cmd.args([
        "-p",
        "--model",
        "haiku",
        "--output-format",
        "json",
        "--no-session-persistence",
        "--append-system-prompt",
        &system_prompt(crate::locale::english_name(crate::locale::app_language())),
        "--tools",
        "",
        "--disable-slash-commands",
        "--setting-sources",
        "project",
        "--strict-mcp-config",
    ])
    .current_dir(&cwd)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // no console window
    let mut child = cmd.spawn().map_err(|e| format!("claude won't start: {e}"))?;
    child.stdin.take().ok_or("stdin")?.write_all(prompt.as_bytes()).map_err(|e| e.to_string())?;
    // At most 2 minutes: then give up, and retry on the next round.
    let started = Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            break;
        }
        if started.elapsed() > Duration::from_secs(120) {
            let _ = child.kill();
            return Err("claude -p did not answer within 2 minutes".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let body: serde_json::Value = serde_json::from_slice(&out.stdout)
        .map_err(|_| format!("claude -p: non-JSON answer: {}", String::from_utf8_lossy(&out.stderr).chars().take(300).collect::<String>()))?;
    if body["is_error"].as_bool() == Some(true) {
        return Err(format!("claude -p: {}", body["result"].as_str().unwrap_or("error")));
    }
    body["result"].as_str().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).ok_or_else(|| "claude -p: empty answer".into())
}

/// The sessions being described right now: never the same one twice at once.
static BUSY: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// A session's description: from the cache if the transcript hasn't changed
/// (or if `force` is false and the cache is recent), otherwise from `claude -p`.
pub fn describe(s: &Session, force: bool) -> Result<Description, String> {
    let id = s.session_id.clone().ok_or("the session has no transcript: nothing to describe")?;
    let fp = fingerprint(s).ok_or("the session has no transcript: nothing to describe")?;
    if !force {
        if let Some(d) = read_cache().get(&id) {
            if d.fingerprint == fp {
                return Ok(d.clone());
            }
        }
    }
    if !enabled() {
        return Err("session descriptions are off: turn them on in the panel, or set DEVDECK_DESCRIBE=1".into());
    }
    {
        let mut busy = BUSY.lock().unwrap_or_else(|e| e.into_inner());
        let set = busy.get_or_insert_with(HashSet::new);
        if !set.insert(id.clone()) {
            return Err("already describing it".into());
        }
    }
    let result = (|| {
        let path = s.transcript.as_ref().ok_or("no transcript")?;
        let tail = read_tail(Path::new(path), 512 * 1024);
        if tail.messages.is_empty() {
            return Err("the transcript has no messages yet".to_string());
        }
        let text = ask_claude(&prompt_for(s, &tail.messages))?;
        let d = Description { text, at: now(), fingerprint: fp };
        let mut cache = read_cache();
        cache.insert(id.clone(), d.clone());
        write_cache(&cache)?;
        Ok(d)
    })();
    BUSY.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).remove(&id);
    result
}

/// Does it need a refresh on its own? The transcript changed and the description
/// is older than `min_age` seconds (or missing).
pub fn stale(s: &Session, cache: &HashMap<String, Description>, min_age: u64) -> bool {
    let (Some(id), Some(fp)) = (&s.session_id, fingerprint(s)) else { return false };
    match cache.get(id) {
        None => true,
        Some(d) => d.fingerprint != fp && now().saturating_sub(d.at) >= min_age,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sessions::{Kind, Match};

    fn session() -> Session {
        Session {
            pid: 1,
            key: String::new(),
            kind: Kind::Terminal,
            cwd: Some(r"C:\d\dev-deck".into()),
            project: Some("dev-deck".into()),
            run_time: 10,
            session_id: Some("abc".into()),
            transcript: Some("x.jsonl".into()),
            matched: Match::Id,
            title: Some("Dev Deck".into()),
            last_prompt: Some("add the sessions".into()),
            last_activity: Some(1000),
            transcript_size: Some(5000),
            memory: 0,
            children: 0,
            children_memory: 0,
        }
    }

    #[test]
    fn the_description_is_asked_in_the_app_language() {
        assert!(system_prompt(crate::locale::english_name("it")).contains("In one or two sentences in Italian"));
        assert!(system_prompt(crate::locale::english_name("de")).contains("In one or two sentences in English"));
    }

    #[test]
    fn prompt_has_folder_title_and_tail_in_order() {
        let msgs = vec![("user".into(), "build the panel".into()), ("assistant".into(), "x".repeat(2000))];
        let p = prompt_for(&session(), &msgs);
        assert!(p.contains(r"Folder: C:\d\dev-deck"));
        assert!(p.contains("The person's last prompt: add the sessions"));
        let person = p.find("Person: build the panel").unwrap();
        let claude = p.find("Claude: xxx").unwrap();
        assert!(person < claude);
        // Each message shortened to 600 characters.
        assert!(!p.contains(&"x".repeat(601)));
    }

    #[test]
    fn stale_only_if_transcript_changed_and_description_is_old() {
        let s = session();
        let fp = fingerprint(&s).unwrap();
        let mut cache = HashMap::new();
        assert!(stale(&s, &cache, 1800));
        cache.insert("abc".into(), Description { text: "t".into(), at: now(), fingerprint: fp.clone() });
        assert!(!stale(&s, &cache, 1800));
        cache.insert("abc".into(), Description { text: "t".into(), at: now(), fingerprint: "other".into() });
        assert!(!stale(&s, &cache, 1800), "changed but just written: wait");
        cache.insert("abc".into(), Description { text: "t".into(), at: now() - 2000, fingerprint: "other".into() });
        assert!(stale(&s, &cache, 1800));
    }

    #[test]
    fn renames_the_old_cache_once() {
        let dir = std::env::temp_dir().join(format!("devdeck-cache-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("sessioni.json"), "{}").unwrap();
        migrate_cache(&dir);
        assert!(!dir.join("sessioni.json").exists());
        assert_eq!(std::fs::read_to_string(dir.join("sessions.json")).unwrap(), "{}");
        // An existing sessions.json is never overwritten.
        std::fs::write(dir.join("sessioni.json"), "old").unwrap();
        migrate_cache(&dir);
        assert_eq!(std::fs::read_to_string(dir.join("sessions.json")).unwrap(), "{}");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn descriptions_are_off_unless_env_or_config_say_so() {
        let on = Some(r#"{"describe_sessions":true}"#);
        assert!(!enabled_from(None, None));
        assert!(!enabled_from(None, Some("not json")));
        assert!(enabled_from(None, on));
        assert!(enabled_from(Some("1"), None));
        assert!(!enabled_from(Some("0"), on), "the env var wins over the file");
        assert!(enabled_from(Some(" ON "), Some(r#"{"describe_sessions":false}"#)));
        assert!(enabled_from(Some("maybe"), on), "an unknown value falls back to the file");
    }
}
