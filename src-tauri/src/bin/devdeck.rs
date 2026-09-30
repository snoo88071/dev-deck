//! `devdeck`: the development processes as JSON, for whoever isn't the panel (the MCP for Claude Code).
//!
//!   devdeck list                      the groups, as the panel sees them
//!   devdeck kill <pid> [<pid>...]     kills the processes with their tree
//!   devdeck restart <pid> [--title T] kills and relaunches with command, folder and environment
//!   devdeck sessions                  the open Claude Code sessions, with their transcript
//!   devdeck describe <id> [--force]   what a session is working on (claude -p, cached; only if descriptions are on)
//!   devdeck jobs                      the scheduled tasks that run something in a project, by project
//!
//! Always exits with JSON on stdout: `{"ok":true,...}` or `{"ok":false,"error":"..."}`.

use dev_deck_lib::{actions, describe, procs, sessions, tasks};
use serde_json::{json, Value};
use sysinfo::System;

#[derive(Debug, PartialEq)]
enum Cmd {
    List,
    Sessions,
    Jobs,
    Describe { id: String, force: bool },
    Kill(Vec<u32>),
    Restart { pid: u32, title: String },
}

fn parse(args: &[String]) -> Result<Cmd, String> {
    let pid = |s: &String| s.parse::<u32>().map_err(|_| format!("invalid pid: {s}"));
    match args.first().map(String::as_str) {
        Some("list") => Ok(Cmd::List),
        Some("sessions") => Ok(Cmd::Sessions),
        Some("jobs") => Ok(Cmd::Jobs),
        Some("describe") => Ok(Cmd::Describe {
            id: args.get(1).filter(|a| !a.starts_with("--")).cloned().ok_or("describe needs a session id (or pid)")?,
            force: args.iter().any(|a| a == "--force"),
        }),
        Some("kill") => {
            let pids = args[1..].iter().map(pid).collect::<Result<Vec<_>, _>>()?;
            if pids.is_empty() {
                return Err("kill needs at least one pid".into());
            }
            Ok(Cmd::Kill(pids))
        }
        Some("restart") => {
            let p = args.get(1).ok_or("restart needs a pid")?;
            let title = match args.iter().position(|a| a == "--title") {
                Some(i) => args.get(i + 1).cloned().ok_or("--title needs a text")?,
                None => "Dev Deck".into(),
            };
            Ok(Cmd::Restart { pid: pid(p)?, title })
        }
        Some(other) => Err(format!("unknown command: {other} (list, sessions, jobs, describe, kill, restart)")),
        None => Err("usage: devdeck list | sessions | jobs | describe <id> [--force] | kill <pid>... | restart <pid> [--title T]".into()),
    }
}

fn run(cmd: Cmd) -> Result<Value, String> {
    let mut sys = System::new();
    match cmd {
        Cmd::List => {
            // Two reads apart: CPU is the difference between them.
            procs::snapshot(&mut sys);
            std::thread::sleep(std::time::Duration::from_millis(300));
            let all = procs::snapshot(&mut sys);
            let own = procs::own_tree(&all);
            let mut groups = procs::group(&all, &|p| p.exists(), &own);
            procs::tag_tasks(&mut groups, &all, &tasks::engines());
            Ok(json!({ "groups": groups }))
        }
        Cmd::Sessions => {
            let all = procs::snapshot(&mut sys);
            // With the cached description, if any.
            let cache = describe::read_cache();
            let list: Vec<_> = sessions::list(&all, &sessions::projects_root())
                .into_iter()
                .map(|s| {
                    let d = s.session_id.as_ref().and_then(|id| cache.get(id)).cloned();
                    let fresh = d.as_ref().is_some_and(|d| Some(&d.fingerprint) == describe::fingerprint(&s).as_ref());
                    json!({ "session": s, "description": d, "description_fresh": fresh })
                })
                .collect();
            Ok(json!({ "sessions": list, "describe_sessions": describe::enabled() }))
        }
        Cmd::Describe { id, force } => {
            let all = procs::snapshot(&mut sys);
            let s = sessions::list(&all, &sessions::projects_root())
                .into_iter()
                .find(|s| s.session_id.as_deref() == Some(id.as_str()) || s.pid.to_string() == id)
                .ok_or_else(|| format!("no open session with id or pid {id}"))?;
            Ok(json!({ "description": describe::describe(&s, force)? }))
        }
        Cmd::Jobs => Ok(json!({ "groups": tasks::jobs()? })),
        Cmd::Kill(pids) => Ok(json!({ "killed": actions::kill(&mut sys, &pids)? })),
        Cmd::Restart { pid, title } => {
            actions::restart(&mut sys, pid, &title)?;
            Ok(json!({ "restarted": pid }))
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let out = match parse(&args).and_then(run) {
        Ok(Value::Object(mut m)) => {
            m.insert("ok".into(), json!(true));
            Value::Object(m)
        }
        Ok(v) => json!({ "ok": true, "result": v }),
        Err(e) => json!({ "ok": false, "error": e }),
    };
    println!("{out}");
    if out["ok"] != json!(true) {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(s: &[&str]) -> Vec<String> {
        s.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_the_arguments() {
        assert_eq!(parse(&a(&["list"])), Ok(Cmd::List));
        assert_eq!(parse(&a(&["sessions"])), Ok(Cmd::Sessions));
        assert_eq!(parse(&a(&["jobs"])), Ok(Cmd::Jobs));
        assert_eq!(parse(&a(&["describe", "abc", "--force"])), Ok(Cmd::Describe { id: "abc".into(), force: true }));
        assert!(parse(&a(&["describe"])).is_err());
        assert_eq!(parse(&a(&["kill", "12", "34"])), Ok(Cmd::Kill(vec![12, 34])));
        assert_eq!(parse(&a(&["restart", "7", "--title", "acme-shop"])), Ok(Cmd::Restart { pid: 7, title: "acme-shop".into() }));
        assert_eq!(parse(&a(&["restart", "7"])), Ok(Cmd::Restart { pid: 7, title: "Dev Deck".into() }));
        assert!(parse(&a(&["kill"])).is_err());
        assert!(parse(&a(&["kill", "x"])).is_err());
        assert!(parse(&a(&["what"])).is_err());
        assert!(parse(&a(&[])).is_err());
    }

    #[test]
    fn list_is_json_with_the_cleanup_fields() {
        let v = run(Cmd::List).unwrap();
        let groups = v["groups"].as_array().unwrap();
        for g in groups {
            for p in g["procs"].as_array().unwrap() {
                assert!(p["parent_alive"].is_boolean());
                assert!(p.get("claude_pid").is_some());
            }
        }
    }
}
