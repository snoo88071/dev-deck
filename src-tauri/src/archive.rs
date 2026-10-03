//! The history of Claude Code sessions: every transcript under `~/.claude/projects`
//! that a person opened (from a terminal or VS Code), open or closed, so one can be
//! found again and resumed without knowing its id.
//!
//! The automated ones (`claude -p`, the SDK: most of the files) and the sub-agents'
//! transcripts (in sub-folders) are left out. Reading every transcript takes a while,
//! so what was read is kept in `~/.dev-deck/history.json`, tied to each file's size and
//! last modification: only new or changed files are read again.

use crate::sessions::{read_tail, Kind, Match, Session};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// What the head of a transcript says: enough to tell a person's session from an automated one.
const HEAD_BYTES: u64 = 64 * 1024;
/// The tail: the title and the last prompt.
const TAIL_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Past {
    pub session_id: String,
    pub transcript: String,
    pub kind: Kind,
    pub cwd: Option<String>,
    /// The working folder's name.
    pub project: Option<String>,
    pub branch: Option<String>,
    /// The first message's time, as the transcript writes it (ISO 8601).
    pub started: Option<String>,
    /// When the transcript was last written (Unix seconds).
    pub ended: u64,
    pub title: Option<String>,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub size: u64,
}

/// What the head of a transcript says.
#[derive(Debug, Default, PartialEq)]
pub struct Head {
    /// `cli`, `claude-vscode`, `sdk-cli`… from the first user message.
    pub entrypoint: Option<String>,
    pub session_id: Option<String>,
    pub cwd: Option<String>,
    pub branch: Option<String>,
    pub started: Option<String>,
    pub first_prompt: Option<String>,
}

/// A message's text: a string, or the text blocks of a list. Injected system text (`<…>`) doesn't count.
fn text_of(v: &serde_json::Value) -> Option<String> {
    let content = &v["message"]["content"];
    let text = if let Some(s) = content.as_str() {
        s.to_string()
    } else {
        content.as_array()?.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n")
    };
    let text = text.trim();
    (!text.is_empty() && !text.starts_with('<')).then(|| text.chars().take(500).collect())
}

pub fn parse_head(text: &str) -> Head {
    let mut h = Head::default();
    for line in text.lines() {
        // Most lines are Claude's turns and tool results: skip them before parsing.
        if !line.contains(r#""type":"user""#) {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v.get("type").and_then(|t| t.as_str()) != Some("user") || v.get("isSidechain").and_then(|x| x.as_bool()) == Some(true) {
            continue;
        }
        let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
        if h.entrypoint.is_none() {
            h.entrypoint = s("entrypoint");
            h.session_id = s("sessionId");
            h.cwd = s("cwd");
            h.branch = s("gitBranch").filter(|b| !b.is_empty() && b != "HEAD");
            h.started = s("timestamp");
        }
        if h.first_prompt.is_none() {
            h.first_prompt = text_of(&v);
        }
        // Automated (most transcripts): nothing more to learn from it.
        if h.first_prompt.is_some() || h.entrypoint.as_deref().is_some_and(|e| kind_of(e).is_none()) {
            break;
        }
    }
    h
}

/// A person's session: from a terminal or from VS Code. Everything else (`sdk-cli`: `claude -p`, the SDK) is automated.
pub fn kind_of(entrypoint: &str) -> Option<Kind> {
    match entrypoint {
        "cli" => Some(Kind::Terminal),
        "claude-vscode" => Some(Kind::VsCode),
        _ => None,
    }
}

fn read_head(path: &Path) -> String {
    let mut buf = Vec::new();
    if let Ok(f) = std::fs::File::open(path) {
        let _ = f.take(HEAD_BYTES).read_to_end(&mut buf);
    }
    String::from_utf8_lossy(&buf).into_owned()
}

/// One transcript read from scratch: None if it isn't a person's session.
pub fn read_one(path: &Path, size: u64, modified: u64) -> Option<Past> {
    let head = parse_head(&read_head(path));
    let kind = kind_of(head.entrypoint.as_deref()?)?;
    let tail = read_tail(path, TAIL_BYTES);
    let last_prompt = tail.last_prompt.or_else(|| tail.messages.iter().rev().find(|(r, _)| r == "user").map(|(_, t)| t.clone()));
    let cwd = head.cwd.map(|c| c.trim_end_matches(['\\', '/']).to_string());
    Some(Past {
        session_id: head.session_id.or_else(|| path.file_stem().map(|s| s.to_string_lossy().into_owned()))?,
        transcript: path.to_string_lossy().into_owned(),
        kind,
        project: cwd.as_ref().and_then(|c| Path::new(c).components().last()).map(|c| c.as_os_str().to_string_lossy().into_owned()),
        cwd,
        branch: head.branch,
        started: head.started,
        ended: modified,
        title: tail.title,
        first_prompt: head.first_prompt,
        last_prompt: last_prompt.map(|t| t.chars().take(500).collect()),
        size,
    })
}

/// A past session as the descriptions see it: describe.rs works on sessions, and
/// fingerprints them by the transcript's size and last write, as it does the open ones.
pub fn as_session(p: &Past) -> Session {
    Session {
        pid: 0,
        key: String::new(),
        kind: p.kind.clone(),
        cwd: p.cwd.clone(),
        project: p.project.clone(),
        run_time: 0,
        session_id: Some(p.session_id.clone()),
        transcript: Some(p.transcript.clone()),
        matched: Match::Id,
        title: p.title.clone(),
        last_prompt: p.last_prompt.clone(),
        last_activity: Some(p.ended),
        transcript_size: Some(p.size),
        memory: 0,
        children: 0,
        children_memory: 0,
    }
}

/// A session of the history, by id.
pub fn find(id: &str) -> Option<Past> {
    list(&crate::sessions::projects_root(), &index_path()).into_iter().find(|p| p.session_id == id)
}

/* ---------- the index ---------- */

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct Entry {
    size: u64,
    modified: u64,
    /// None: read, and not a person's session. Kept so it isn't read again.
    past: Option<Past>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    v: u32,
    entries: HashMap<String, Entry>,
}

pub fn index_path() -> PathBuf {
    if let Ok(p) = std::env::var("DEVDECK_HISTORY") {
        return p.into();
    }
    crate::describe::dir().join("history.json")
}

/// The transcripts directly in each project folder (the sub-agents' sit deeper and are left out).
fn transcripts(root: &Path) -> Vec<(PathBuf, u64, u64)> {
    let mut out = vec![];
    for dir in std::fs::read_dir(root).into_iter().flatten().flatten() {
        if !dir.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        for f in std::fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            let p = f.path();
            if p.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                continue;
            }
            let Ok(m) = f.metadata() else { continue };
            let modified = m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.push((p, m.len(), modified));
        }
    }
    out
}

/// Every session a person opened, most recent first. Reads only what changed since the index was written.
pub fn list(root: &Path, index: &Path) -> Vec<Past> {
    let mut idx: Index = std::fs::read_to_string(index).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let mut changed = idx.v != 1;
    if changed {
        idx = Index { v: 1, entries: HashMap::new() };
    }
    let files = transcripts(root);
    let mut seen = HashMap::with_capacity(files.len());
    for (path, size, modified) in files {
        let key = path.to_string_lossy().into_owned();
        let fresh = idx.entries.get(&key).is_some_and(|e| e.size == size && e.modified == modified);
        let entry = if fresh {
            idx.entries.remove(&key).unwrap_or_default()
        } else {
            changed = true;
            Entry { size, modified, past: read_one(&path, size, modified) }
        };
        seen.insert(key, entry);
    }
    // Transcripts that were deleted leave the index too.
    changed |= idx.entries.keys().any(|k| !seen.contains_key(k));
    idx.entries = seen;
    if changed {
        if let Some(dir) = index.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let tmp = index.with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_string(&idx).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, index);
        }
    }
    let mut out: Vec<Past> = idx.entries.into_values().filter_map(|e| e.past).collect();
    out.sort_by(|a, b| b.ended.cmp(&a.ended));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(entry: &str, text: &str, extra: &str) -> String {
        format!(
            r#"{{"type":"user","entrypoint":"{entry}","sessionId":"11111111-2222-3333-4444-555555555555","cwd":"C:\\d\\dev-deck","gitBranch":"peso","timestamp":"2026-10-01T06:00:00.000Z"{extra},"message":{{"role":"user","content":"{text}"}}}}"#
        )
    }

    #[test]
    fn the_head_says_who_opened_it_and_the_first_real_prompt() {
        let text = [
            r#"{"type":"queue-operation","operation":"enqueue"}"#.to_string(),
            user("cli", "<command-name>/clear</command-name>", ""),
            user("cli", "fix the CSP", ""),
        ]
        .join("\n");
        let h = parse_head(&text);
        assert_eq!(h.entrypoint.as_deref(), Some("cli"));
        assert_eq!(h.cwd.as_deref(), Some(r"C:\d\dev-deck"));
        assert_eq!(h.branch.as_deref(), Some("peso"));
        assert_eq!(h.first_prompt.as_deref(), Some("fix the CSP"));
    }

    #[test]
    fn sub_agents_lines_dont_count() {
        let h = parse_head(&user("cli", "a sub-agent's task", r#","isSidechain":true"#));
        assert_eq!(h, Head::default());
    }

    #[test]
    fn only_terminal_and_vscode_are_a_persons_sessions() {
        assert_eq!(kind_of("cli"), Some(Kind::Terminal));
        assert_eq!(kind_of("claude-vscode"), Some(Kind::VsCode));
        assert_eq!(kind_of("sdk-cli"), None);
    }

    #[test]
    fn the_index_keeps_people_leaves_automation_out_and_reads_only_what_changed() {
        let dir = std::env::temp_dir().join(format!("devdeck-archive-{}", std::process::id()));
        let root = dir.join("projects");
        let proj = root.join("C--d-dev-deck");
        std::fs::create_dir_all(proj.join("abc").join("subagents")).unwrap();
        let tail = r#"{"type":"ai-title","aiTitle":"CSP fix"}"#;
        std::fs::write(proj.join("a.jsonl"), format!("{}\n{tail}\n", user("cli", "fix the CSP", ""))).unwrap();
        std::fs::write(proj.join("b.jsonl"), user("sdk-cli", "describe this", "") + "\n").unwrap();
        std::fs::write(proj.join("abc").join("subagents").join("c.jsonl"), user("cli", "deep", "") + "\n").unwrap();
        let index = dir.join("history.json");

        let first = list(&root, &index);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].title.as_deref(), Some("CSP fix"));
        assert_eq!(first[0].project.as_deref(), Some("dev-deck"));
        assert_eq!(first[0].kind, Kind::Terminal);

        // From the index: a transcript whose size and time didn't change is not read again.
        let mut idx: Index = serde_json::from_str(&std::fs::read_to_string(&index).unwrap()).unwrap();
        for e in idx.entries.values_mut() {
            if let Some(p) = e.past.as_mut() {
                p.title = Some("from the index".into());
            }
        }
        std::fs::write(&index, serde_json::to_string(&idx).unwrap()).unwrap();
        assert_eq!(list(&root, &index)[0].title.as_deref(), Some("from the index"));

        std::fs::remove_file(proj.join("a.jsonl")).unwrap();
        assert!(list(&root, &index).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The real transcripts: `cargo test -- --ignored real_history --nocapture`.
    #[test]
    #[ignore]
    fn real_history() {
        let root = crate::sessions::projects_root();
        let index = std::env::temp_dir().join("devdeck-real-history.json");
        let _ = std::fs::remove_file(&index);
        let t = std::time::Instant::now();
        let n = list(&root, &index).len();
        let cold = t.elapsed();
        let t = std::time::Instant::now();
        let again = list(&root, &index).len();
        let warm = t.elapsed();
        let files = transcripts(&root).len();
        println!("{files} transcripts, {n} sessions opened by a person; cold {cold:?}, from the index {warm:?} ({again})");
        let _ = std::fs::remove_file(&index);
    }
}
