//! Kill, restart, open.
//!
//! Every action gets pids from the panel and checks them again here: they must
//! be development processes, still alive, and not Dev Deck's. The panel's list
//! may be three seconds old, and in the meantime a pid may have passed to
//! another process.

use crate::procs::{self, RawProc};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A pid can be touched if it is still a development process and not Dev Deck.
fn allowed(all: &[RawProc], pid: u32) -> Result<&RawProc, String> {
    let own = procs::own_tree(all);
    if own.contains(&pid) {
        return Err("it is Dev Deck itself".into());
    }
    let p = all.iter().find(|p| p.pid == pid).ok_or_else(|| format!("process {pid} is gone"))?;
    if procs::runtime_of(&p.name).is_none() {
        return Err(format!("process {pid} ({}) is not a development process", p.name));
    }
    Ok(p)
}

/// Kills a process with its whole tree (on Windows `taskkill /T`: including the
/// cmd.exe and child node processes the panel doesn't show).
fn kill_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let out = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        // 128 = process already exited: fine for whoever wanted it dead.
        if out.status.success() || out.status.code() == Some(128) {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    #[cfg(not(windows))]
    {
        let mut sys = System::new();
        sys.refresh_processes(ProcessesToUpdate::All, true);
        let mut tree = vec![pid];
        let mut i = 0;
        while i < tree.len() {
            let cur = tree[i];
            for p in sys.processes().values() {
                if p.parent().map(|x| x.as_u32()) == Some(cur) {
                    tree.push(p.pid().as_u32());
                }
            }
            i += 1;
        }
        for p in tree.iter().rev() {
            if let Some(proc_) = sys.process(procs::pid(*p)) {
                proc_.kill();
            }
        }
        Ok(())
    }
}

/// Kills the given processes (one process, or all of a project's).
pub fn kill(sys: &mut System, pids: &[u32]) -> Result<usize, String> {
    let all = procs::snapshot(sys);
    let mut done = 0;
    let mut errors = vec![];
    let wanted: HashSet<u32> = pids.iter().copied().collect();
    for pid in pids {
        // If the ancestor is already in the list, it goes down with it.
        let p = match allowed(&all, *pid) {
            Ok(p) => p,
            Err(e) => {
                errors.push(e);
                continue;
            }
        };
        if p.parent.is_some_and(|x| wanted.contains(&x)) {
            continue;
        }
        match kill_tree(*pid) {
            Ok(()) => done += 1,
            Err(e) => errors.push(format!("{pid}: {e}")),
        }
    }
    if errors.is_empty() || done > 0 {
        Ok(done)
    } else {
        Err(errors.join("; "))
    }
}

/// Restarts a process: reads command, folder and environment, kills it and
/// relaunches it as it was in a new window (where you see the output and stop it with Ctrl+C).
/// The environment is the original one: a `PORT=8793` or a `TT_DB=...` is not lost.
pub fn restart(sys: &mut System, pid: u32, title: &str) -> Result<(), String> {
    let all = procs::snapshot(sys);
    let p = allowed(&all, pid)?.clone();
    let cwd = p.cwd.clone().ok_or("can't tell which folder it runs in: can't relaunch it")?;
    if p.cmd.is_empty() {
        return Err("can't read its command: can't relaunch it".into());
    }
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[procs::pid(pid)]),
        false,
        ProcessRefreshKind::nothing().with_environ(UpdateKind::Always),
    );
    let env: Vec<(String, String)> = sys
        .process(procs::pid(pid))
        .map(|x| {
            x.environ()
                .iter()
                .filter_map(|kv| kv.to_str()?.split_once('=').map(|(k, v)| (k.to_string(), v.to_string())))
                .filter(|(k, _)| !k.is_empty())
                .collect()
        })
        .unwrap_or_default();

    kill_tree(pid)?;
    // The port is freed only once the process has really exited.
    for _ in 0..30 {
        sys.refresh_processes(ProcessesToUpdate::Some(&[procs::pid(pid)]), true);
        if sys.process(procs::pid(pid)).is_none() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    launch(&p.cmd, &cwd, &env, title)
}

#[cfg(windows)]
fn launch(cmd: &[String], cwd: &Path, env: &[(String, String)], title: &str) -> Result<(), String> {
    // `start "title" cmd /k <command>`: its own window, which stays open if the command exits.
    let line = procs::join_cmd(cmd);
    let mut c = Command::new("cmd");
    c.current_dir(cwd).creation_flags(CREATE_NO_WINDOW);
    if !env.is_empty() {
        c.env_clear().envs(env.iter().cloned());
    }
    // The outer quotes around the command are needed: with more than two quotes
    // `cmd /k` strips the first and the last, and without these it would split
    // "C:\Program Files\nodejs\node.exe" (seen on 9/26 restarting acme-shop).
    c.raw_arg(format!("/c start \"{}\" cmd /k \"{}\"", title.replace('"', "'"), line));
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn launch(cmd: &[String], cwd: &Path, env: &[(String, String)], _title: &str) -> Result<(), String> {
    let mut c = Command::new(&cmd[0]);
    c.args(&cmd[1..]).current_dir(cwd);
    if !env.is_empty() {
        c.env_clear().envs(env.iter().cloned());
    }
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Opens a local address in the browser. Only http://localhost:PORT.
pub fn open_port(port: u16) -> Result<(), String> {
    open_target(&format!("http://localhost:{port}"))
}

/// Opens a folder: in File Explorer, or in VS Code. In VS Code also a file (a task's script).
pub fn open_folder(path: &str, editor: bool) -> Result<(), String> {
    let p = Path::new(path);
    if !(p.is_dir() || (editor && p.is_file())) {
        return Err(format!("{path} is not a folder"));
    }
    if editor {
        #[cfg(windows)]
        {
            // `code` is code.cmd: go through cmd.
            return Command::new("cmd")
                .args(["/c", "code", path])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(|_| ())
                .map_err(|e| e.to_string());
        }
        #[cfg(not(windows))]
        return Command::new("code").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    #[cfg(windows)]
    return Command::new("explorer").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string());
    #[cfg(not(windows))]
    return open_target(path);
}

fn open_target(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    return Command::new("cmd")
        .args(["/c", "start", "", target])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string());
    #[cfg(target_os = "macos")]
    return Command::new("open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string());
    #[cfg(all(unix, not(target_os = "macos")))]
    return Command::new("xdg-open").arg(target).spawn().map(|_| ()).map_err(|e| e.to_string());
}

/* ---------- the shadow file (the same as the MCP's: ~/.dev-deck/shadow.jsonl) ---------- */

pub fn shadow_path() -> PathBuf {
    if let Ok(p) = std::env::var("DEVDECK_SHADOW") {
        return p.into();
    }
    let dir = crate::describe::dir();
    migrate_shadow(&dir);
    dir.join("shadow.jsonl")
}

/// The Italian values of older versions, mapped to the current ones.
fn legacy_value(field: &str, v: &str) -> Option<&'static str> {
    Some(match (field, v) {
        ("type", "proposta") => "proposal",
        ("type", "giudizio") => "verdict",
        ("type", "azione") => "action",
        ("verdict", "chiudi") => "close",
        ("verdict", "giusta-lascia") => "keep",
        ("verdict", "sbagliata") => "wrong",
        ("source", "pannello") => "panel",
        ("category", "mcp-orfano") => "orphan-mcp",
        ("category", "doppione") => "duplicate",
        ("category", "sessione") => "session",
        ("category", "fermo") => "idle",
        _ => return None,
    })
}

/// One line of the old file in the current vocabulary; untouched if it doesn't parse.
fn migrate_line(line: &str) -> String {
    let Ok(mut v) = serde_json::from_str::<serde_json::Value>(line) else { return line.to_string() };
    let Some(obj) = v.as_object_mut() else { return line.to_string() };
    let mut changed = false;
    for field in ["type", "verdict", "source", "category"] {
        let new = obj.get(field).and_then(|x| x.as_str()).and_then(|x| legacy_value(field, x));
        if let Some(new) = new {
            obj.insert(field.into(), new.into());
            changed = true;
        }
    }
    if changed { v.to_string() } else { line.to_string() }
}

/// Older versions wrote `ombra.jsonl` with Italian values: convert it once into
/// `shadow.jsonl` and keep the old one as `.bak`. Never overwrites a shadow.jsonl.
fn migrate_shadow(dir: &Path) {
    let old = dir.join("ombra.jsonl");
    let new = dir.join("shadow.jsonl");
    if new.exists() {
        return;
    }
    let Ok(text) = std::fs::read_to_string(&old) else { return };
    let out: String = text.lines().map(|l| migrate_line(l) + "\n").collect();
    if std::fs::write(&new, out).is_ok() {
        let _ = std::fs::rename(&old, dir.join("ombra.jsonl.bak"));
    }
}

/// Every line of the shadow file; broken ones are skipped.
pub fn shadow_read() -> Vec<serde_json::Value> {
    let Ok(text) = std::fs::read_to_string(shadow_path()) else {
        return vec![];
    };
    text.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str(l).ok()).collect()
}

/// Appends a line. Only objects with a known `type`: the panel writes nothing else.
pub fn shadow_append(record: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let kind = record.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if !["proposal", "verdict", "action"].contains(&kind) {
        return Err(format!("invalid shadow record: type \"{kind}\""));
    }
    let path = shadow_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
    writeln!(f, "{record}").map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_the_old_shadow_file_once() {
        let dir = std::env::temp_dir().join(format!("devdeck-shadow-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let lines = [
            r#"{"type":"proposta","id":"p1","category":"doppione","pid":7}"#,
            r#"{"type":"giudizio","proposal":"p1","verdict":"giusta-lascia","source":"pannello"}"#,
            r#"{"type":"azione","action":"kill","source":"claude","pids":[7]}"#,
            "not json",
        ];
        std::fs::write(dir.join("ombra.jsonl"), lines.join("\n")).unwrap();
        migrate_shadow(&dir);
        assert!(!dir.join("ombra.jsonl").exists());
        assert!(dir.join("ombra.jsonl.bak").exists());
        let text = std::fs::read_to_string(dir.join("shadow.jsonl")).unwrap();
        let out: Vec<&str> = text.lines().collect();
        let v: Vec<serde_json::Value> = out[..3].iter().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!((v[0]["type"].as_str(), v[0]["category"].as_str(), v[0]["pid"].as_u64()), (Some("proposal"), Some("duplicate"), Some(7)));
        assert_eq!((v[1]["type"].as_str(), v[1]["verdict"].as_str(), v[1]["source"].as_str()), (Some("verdict"), Some("keep"), Some("panel")));
        assert_eq!((v[2]["type"].as_str(), v[2]["source"].as_str()), (Some("action"), Some("claude")));
        assert_eq!(out[3], "not json");
        // A second run, even with a new ombra.jsonl, never touches shadow.jsonl.
        std::fs::write(dir.join("ombra.jsonl"), "{}").unwrap();
        migrate_shadow(&dir);
        assert_eq!(std::fs::read_to_string(dir.join("shadow.jsonl")).unwrap(), text);
        std::fs::remove_dir_all(dir).ok();
    }
}
