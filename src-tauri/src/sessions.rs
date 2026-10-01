//! The open Claude Code sessions: from a terminal, from VS Code, background jobs.
//!
//! The process is a `claude.exe`; the session is its transcript in
//! `~/.claude/projects/<folder>/<id>.jsonl`. The id is read from the command
//! (`--session-id`, or `--resume` without `--fork-session`); if missing, we take
//! the transcript in its folder that was created after the process started and
//! written last. From the transcript: the title, the last prompt, the last activity.
//!
//! Sessions never enter cleanup. The panel closes one only when asked, whole:
//! Claude Code with its tree (`actions::close_session`).

use crate::procs::{runtime_of, RawProc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Terminal,
    VsCode,
    Background,
}

/// What a claude.exe's command says.
#[derive(Debug, PartialEq)]
pub struct Args {
    /// None = infrastructure (daemon, pty-host) or `claude -p`: not a session to show.
    pub kind: Option<Kind>,
    /// The session id, if the command states it for sure.
    pub session_id: Option<String>,
}

fn flag_value(cmd: &[String], name: &str) -> Option<String> {
    for (i, a) in cmd.iter().enumerate() {
        if a == name {
            return cmd.get(i + 1).cloned();
        }
        if let Some(v) = a.strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
    }
    None
}

fn is_uuid(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Reads a claude.exe's command. `parent_is_pty_host`: the parent is a `--bg-pty-host`.
pub fn parse_args(cmd: &[String], parent_is_pty_host: bool) -> Args {
    let has = |f: &str| cmd.iter().any(|a| a == f || a.starts_with(&format!("{f}=")));
    let first = cmd.first().map(|s| s.to_lowercase()).unwrap_or_default();
    let infra = cmd.get(1).map(String::as_str) == Some("daemon") || has("--bg-pty-host") || has("-p") || has("--print");
    let kind = if infra {
        None
    } else if parent_is_pty_host {
        Some(Kind::Background)
    } else if first.contains(".vscode") || first.contains("\\extensions\\") || has("--permission-prompt-tool") && has("--input-format") {
        Some(Kind::VsCode)
    } else {
        Some(Kind::Terminal)
    };
    // --session-id always counts (even with --fork-session: it's the new id). --resume only without fork.
    let session_id = flag_value(cmd, "--session-id")
        .filter(|s| is_uuid(s))
        .or_else(|| if has("--fork-session") { None } else { flag_value(cmd, "--resume").filter(|s| is_uuid(s)) });
    Args { kind, session_id }
}

/// The transcripts folder name: every character that is not a letter or digit becomes `-`.
pub fn slug(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/']).chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// A transcript on disk.
#[derive(Clone, Debug)]
pub struct FileInfo {
    pub path: PathBuf,
    pub created: u64,
    pub modified: u64,
}

/// A process to match.
#[derive(Clone, Debug)]
pub struct ToMatch {
    pub pid: u32,
    pub start: u64,
    pub dir_key: String,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Match {
    /// From the id in the command.
    Id,
    /// The only transcript created after the process started.
    Time,
    /// Several possible transcripts: took the one written last.
    Uncertain,
    /// No transcript found (the session hasn't written anything yet).
    None,
}

/// Matches processes to transcripts. `files` by folder (lowercase key).
/// First those with an id; then, starting from the process that started last, the
/// transcript not yet taken, created after it started, written last.
pub fn match_transcripts(procs: &[ToMatch], files: &HashMap<String, Vec<FileInfo>>) -> HashMap<u32, (Option<PathBuf>, Match)> {
    const SLACK: u64 = 10; // seconds: the transcript may be created a moment before the process that writes it
    const LATE: u64 = 15 * 60; // a transcript created later than this after the start is an uncertain match
    let mut out = HashMap::new();
    let mut taken: HashSet<PathBuf> = HashSet::new();
    for p in procs {
        if let Some(id) = &p.session_id {
            let found = files
                .get(&p.dir_key)
                .and_then(|fs| fs.iter().find(|f| f.path.file_stem().and_then(|s| s.to_str()) == Some(id.as_str())));
            if let Some(f) = found {
                taken.insert(f.path.clone());
                out.insert(p.pid, (Some(f.path.clone()), Match::Id));
            }
        }
    }
    let mut rest: Vec<&ToMatch> = procs.iter().filter(|p| !out.contains_key(&p.pid)).collect();
    rest.sort_by_key(|p| std::cmp::Reverse(p.start));
    for p in rest {
        let mut cands: Vec<&FileInfo> = files
            .get(&p.dir_key)
            .map(|fs| fs.iter().filter(|f| !taken.contains(&f.path) && f.created + SLACK >= p.start).collect())
            .unwrap_or_default();
        cands.sort_by_key(|f| std::cmp::Reverse(f.modified));
        match cands.first() {
            Some(f) => {
                taken.insert(f.path.clone());
                // Created long after the start: it may be its own (a /clear), but also a copy made
                // by another process (9/26: a VS Code session was taking a background job's fork).
                let late = f.created > p.start + LATE;
                let how = if cands.len() == 1 && !late { Match::Time } else { Match::Uncertain };
                out.insert(p.pid, (Some(f.path.clone()), how));
            }
            None => {
                out.insert(p.pid, (None, Match::None));
            }
        }
    }
    out
}

/// What is read from a transcript's tail.
#[derive(Clone, Debug, Default, Serialize)]
pub struct Tail {
    pub title: Option<String>,
    pub last_prompt: Option<String>,
    /// The last text messages (user and Claude), for the description.
    #[serde(skip)]
    pub messages: Vec<(String, String)>,
}

/// Reads the last `bytes` of the transcript and gets title, last prompt and messages from it.
pub fn read_tail(path: &Path, bytes: u64) -> Tail {
    let mut out = Tail::default();
    let Ok(mut f) = std::fs::File::open(path) else { return out };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(bytes);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return out;
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return out;
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0); // the first line is cut in half
    }
    for line in lines {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("ai-title") => out.title = v.get("aiTitle").and_then(|x| x.as_str()).map(String::from),
            Some("custom-title") => out.title = v.get("customTitle").and_then(|x| x.as_str()).map(String::from).or(out.title),
            Some("last-prompt") => out.last_prompt = v.get("lastPrompt").and_then(|x| x.as_str()).map(String::from),
            Some(role @ ("user" | "assistant")) => {
                if v.get("isSidechain").and_then(|x| x.as_bool()) == Some(true) {
                    continue;
                }
                let content = &v["message"]["content"];
                let text = if let Some(s) = content.as_str() {
                    s.to_string()
                } else {
                    content
                        .as_array()
                        .map(|a| a.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n"))
                        .unwrap_or_default()
                };
                let text = text.trim();
                // Injected system messages (reminders, command output) don't say what is being worked on.
                if !text.is_empty() && !text.starts_with('<') {
                    out.messages.push((role.to_string(), text.chars().take(1500).collect()));
                }
            }
            _ => {}
        }
    }
    let keep = out.messages.len().saturating_sub(24);
    out.messages.drain(..keep);
    out
}

/* ---------- the real sessions ---------- */

#[derive(Clone, Debug, Serialize)]
pub struct Session {
    pub pid: u32,
    /// `pid@start`: names the session in the CPU history (history.rs) even if the pid is reused.
    pub key: String,
    pub kind: Kind,
    pub cwd: Option<String>,
    /// The working folder's name.
    pub project: Option<String>,
    pub run_time: u64,
    pub session_id: Option<String>,
    pub transcript: Option<String>,
    #[serde(rename = "match")]
    pub matched: Match,
    pub title: Option<String>,
    pub last_prompt: Option<String>,
    /// When the transcript was last written (Unix seconds).
    pub last_activity: Option<u64>,
    /// The transcript size: with `last_activity`, the fingerprint for the descriptions cache.
    pub transcript_size: Option<u64>,
    pub memory: u64,
    /// The development processes it keeps running (mostly MCP servers) and their memory.
    pub children: usize,
    pub children_memory: u64,
}

fn secs(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn projects_root() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
    Path::new(&home).join(".claude").join("projects")
}

fn is_claude(p: &RawProc) -> bool {
    let n = p.name.to_ascii_lowercase();
    n == "claude.exe" || n == "claude"
}

/// The key a session goes by in the CPU history.
pub fn key_of(p: &RawProc) -> String {
    format!("{}@{}", p.pid, p.start)
}

/// The claude.exe that are sessions (not the daemon, the pty host or `claude -p`), with what their command says.
pub fn roots(all: &[RawProc]) -> Vec<(&RawProc, Args)> {
    let by_pid: HashMap<u32, &RawProc> = all.iter().map(|p| (p.pid, p)).collect();
    let pty_host = |pid: Option<u32>| {
        pid.and_then(|x| by_pid.get(&x)).is_some_and(|q| is_claude(q) && q.cmd.iter().any(|a| a == "--bg-pty-host"))
    };
    all.iter()
        .filter(|p| is_claude(p))
        .map(|p| (p, parse_args(&p.cmd, pty_host(p.parent))))
        .filter(|(_, a)| a.kind.is_some())
        .collect()
}

/// The development processes under a session (MCP servers, servers started by Claude).
pub fn descendants(all: &[RawProc], pid: u32) -> Vec<&RawProc> {
    let by_pid: HashMap<u32, &RawProc> = all.iter().map(|p| (p.pid, p)).collect();
    all.iter()
        .filter(|q| runtime_of(&q.name).is_some())
        .filter(|q| {
            let mut seen = HashSet::new();
            let mut cur = q.parent;
            while let Some(x) = cur {
                if x == pid {
                    return true;
                }
                if !seen.insert(x) {
                    return false;
                }
                cur = by_pid.get(&x).and_then(|r| r.parent);
            }
            false
        })
        .collect()
}

/// The open sessions, from a read of the processes.
pub fn list(all: &[RawProc], root: &Path) -> Vec<Session> {
    let now = secs(SystemTime::now());

    struct Found<'a> {
        p: &'a RawProc,
        kind: Kind,
        id: Option<String>,
    }
    let found: Vec<Found> = roots(all)
        .into_iter()
        .filter_map(|(p, a)| a.kind.map(|kind| Found { p, kind, id: a.session_id }))
        .collect();

    // The transcript folders, found ignoring case (c--Users and C--Users).
    let dirs: HashMap<String, PathBuf> = std::fs::read_dir(root)
        .map(|rd| rd.flatten().map(|e| (e.file_name().to_string_lossy().to_lowercase(), e.path())).collect())
        .unwrap_or_default();
    let mut files: HashMap<String, Vec<FileInfo>> = HashMap::new();
    let mut to_match = vec![];
    for f in &found {
        let key = f.p.cwd.as_ref().map(|c| slug(&c.to_string_lossy()).to_lowercase()).unwrap_or_default();
        if !files.contains_key(&key) {
            // Two forms for the same folder (drive letter upper or lower case): read them all.
            let list: Vec<FileInfo> = dirs
                .iter()
                .filter(|(name, _)| **name == key)
                .flat_map(|(_, dir)| std::fs::read_dir(dir).into_iter().flatten().flatten())
                .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("jsonl"))
                .filter_map(|e| {
                    let m = e.metadata().ok()?;
                    Some(FileInfo {
                        path: e.path(),
                        created: m.created().map(secs).unwrap_or(0),
                        modified: m.modified().map(secs).unwrap_or(0),
                    })
                })
                .collect();
            files.insert(key.clone(), list);
        }
        to_match.push(ToMatch { pid: f.p.pid, start: now.saturating_sub(f.p.run_time), dir_key: key, session_id: f.id.clone() });
    }
    let matched = match_transcripts(&to_match, &files);

    let mut out: Vec<Session> = found
        .iter()
        .map(|f| {
            let (path, how) = matched.get(&f.p.pid).cloned().unwrap_or((None, Match::None));
            let meta = path.as_ref().and_then(|p| std::fs::metadata(p).ok());
            let tail = path.as_ref().map(|p| read_tail(p, 512 * 1024)).unwrap_or_default();
            let kids = descendants(all, f.p.pid);
            Session {
                pid: f.p.pid,
                key: key_of(f.p),
                kind: f.kind.clone(),
                cwd: f.p.cwd.as_ref().map(|c| c.to_string_lossy().trim_end_matches(['\\', '/']).to_string()),
                project: f.p.cwd.as_ref().and_then(|c| c.components().last()).map(|c| c.as_os_str().to_string_lossy().to_string()),
                run_time: f.p.run_time,
                session_id: path.as_ref().and_then(|p| p.file_stem()).map(|s| s.to_string_lossy().to_string()).or_else(|| f.id.clone()),
                transcript: path.as_ref().map(|p| p.to_string_lossy().to_string()),
                matched: how,
                title: tail.title,
                last_prompt: tail.last_prompt,
                last_activity: meta.as_ref().and_then(|m| m.modified().ok()).map(secs),
                transcript_size: meta.as_ref().map(|m| m.len()),
                memory: f.p.memory,
                children: kids.len(),
                children_memory: kids.iter().map(|k| k.memory).sum(),
            }
        })
        .collect();
    // Recently active ones first.
    out.sort_by_key(|s| std::cmp::Reverse(s.last_activity.unwrap_or(0)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }
    const ID: &str = "461537d3-589e-493b-babb-6972f4f6aa18";

    #[test]
    fn reads_kind_and_id_from_the_command() {
        assert_eq!(parse_args(&a(&["claude.exe"]), false), Args { kind: Some(Kind::Terminal), session_id: None });
        assert_eq!(parse_args(&a(&["claude.exe", "--resume", ID]), false).session_id.as_deref(), Some(ID));
        // With --fork-session the --resume id is the old one: it doesn't count.
        assert_eq!(parse_args(&a(&["claude.exe", "--resume", ID, "--fork-session"]), false).session_id, None);
        // --session-id counts even with fork, and it's a background job if the parent is a pty-host.
        let bg = parse_args(&a(&["claude.exe", "--session-id", ID, "--fork-session", "--resume", "C:\\x\\t.jsonl"]), true);
        assert_eq!(bg, Args { kind: Some(Kind::Background), session_id: Some(ID.into()) });
        let vs = a(&[r"c:\Users\g\.vscode\extensions\anthropic.claude-code-2.1\resources\native-binary\claude.exe", "--output-format", "stream-json", &format!("--resume={ID}")]);
        assert_eq!(parse_args(&vs, false), Args { kind: Some(Kind::VsCode), session_id: Some(ID.into()) });
        assert_eq!(parse_args(&a(&["claude.exe", "daemon", "run"]), false).kind, None);
        assert_eq!(parse_args(&a(&["claude.exe", "--bg-pty-host", "x"]), false).kind, None);
        assert_eq!(parse_args(&a(&["claude", "-p", "hello"]), false).kind, None);
    }

    #[test]
    fn the_transcripts_folder() {
        assert_eq!(slug(r"C:\Users\dev\code\dev-deck"), "C--Users-dev-code-dev-deck");
        assert_eq!(slug(r"C:\Users\dev\.claude\"), "C--Users-dev--claude");
        assert_eq!(slug(r"C:\Users\dev\code\my_blog"), "C--Users-dev-code-my-blog");
    }

    #[test]
    fn matches_by_id_then_by_time() {
        let f = |name: &str, created: u64, modified: u64| FileInfo { path: PathBuf::from(format!("{name}.jsonl")), created, modified };
        let files = HashMap::from([(
            "d".to_string(),
            vec![f(ID, 100, 900), f("a", 1000, 5000), f("b", 3000, 4000), f("old", 10, 20)],
        )]);
        let p = |pid: u32, start: u64, id: Option<&str>| ToMatch { pid, start, dir_key: "d".into(), session_id: id.map(String::from) };
        let m = match_transcripts(&[p(1, 50, Some(ID)), p(2, 995, None), p(3, 2990, None), p(4, 6000, None)], &files);
        assert_eq!(m[&1], (Some(PathBuf::from(format!("{ID}.jsonl"))), Match::Id));
        // 3 started last of the two: it takes the only one created after it.
        assert_eq!(m[&3], (Some(PathBuf::from("b.jsonl")), Match::Time));
        assert_eq!(m[&2], (Some(PathBuf::from("a.jsonl")), Match::Time));
        // Started after every transcript: it hasn't written anything yet.
        assert_eq!(m[&4], (None, Match::None));
        // Only candidate, but created a day after the start: uncertain.
        let late = HashMap::from([("d".to_string(), vec![f("copy", 100_000, 100_500)])]);
        let m2 = match_transcripts(&[p(9, 10_000, None)], &late);
        assert_eq!(m2[&9].1, Match::Uncertain);
    }

    #[test]
    fn the_transcript_tail() {
        let dir = std::env::temp_dir().join(format!("devdeck-tail-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let lines = [
            r#"{"type":"ai-title","aiTitle":"Old title"}"#,
            r#"{"type":"user","message":{"role":"user","content":"build the panel"}}"#,
            r#"{"type":"user","message":{"role":"user","content":"<system-reminder>nothing</system-reminder>"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Panel done."},{"type":"tool_use","name":"Bash"}]}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"subagent"}]}}"#,
            r#"{"type":"ai-title","aiTitle":"Dev Deck"}"#,
            r#"{"type":"last-prompt","lastPrompt":"add the sessions"}"#,
        ];
        std::fs::write(&path, lines.join("\n")).unwrap();
        let t = read_tail(&path, 1 << 20);
        assert_eq!(t.title.as_deref(), Some("Dev Deck"));
        assert_eq!(t.last_prompt.as_deref(), Some("add the sessions"));
        assert_eq!(t.messages, vec![("user".into(), "build the panel".into()), ("assistant".into(), "Panel done.".into())]);
        // Only the tail read: the cut first line is skipped, the rest holds.
        let t2 = read_tail(&path, 120);
        assert_eq!(t2.last_prompt.as_deref(), Some("add the sessions"));
        std::fs::remove_dir_all(dir).ok();
    }
}
