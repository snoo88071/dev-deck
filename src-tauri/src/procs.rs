//! The machine's development processes, grouped by project.
//!
//! Reading the system (`snapshot`) is kept apart from the logic (`runtime_of`,
//! `project_root`, `group`): the logic works on `RawProc` and is tested with
//! fake processes, without depending on what runs on the machine.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// A process as the system reads it.
#[derive(Clone, Debug)]
pub struct RawProc {
    pub pid: u32,
    pub parent: Option<u32>,
    /// The executable name, e.g. `node.exe`.
    pub name: String,
    pub cmd: Vec<String>,
    pub cwd: Option<PathBuf>,
    pub memory: u64,
    pub cpu: f32,
    pub run_time: u64,
    pub ports: Vec<u16>,
}

/// A process as the panel sees it.
#[derive(Clone, Debug, Serialize)]
pub struct Proc {
    pub pid: u32,
    pub parent: Option<u32>,
    /// The runtime: node, python, cargo...
    pub runtime: String,
    /// The tool launched with the runtime, if it can be told: npm, tsx, vite, uvicorn...
    pub tool: Option<String>,
    pub cmd: String,
    pub cwd: Option<String>,
    pub memory: u64,
    pub cpu: f32,
    pub run_time: u64,
    pub ports: Vec<u16>,
    /// Depth in the group's tree: 0 = root (the one that gets restarted).
    pub depth: usize,
    /// The Claude Code process: killing it ends the session, the panel says so.
    pub claude: bool,
    /// Who launched it, if not a terminal: `claude` for Claude Code's MCP servers, `code`...
    pub launcher: Option<String>,
    /// The parent still exists. An MCP server with a dead parent is what a closed session leaves behind.
    pub parent_alive: bool,
    /// The pid of the nearest Claude Code among the ancestors: the session it belongs to.
    pub claude_pid: Option<u32>,
}

/// The processes of one project.
#[derive(Clone, Debug, Serialize)]
pub struct Group {
    /// The project folder; None if no process has a readable folder.
    pub root: Option<String>,
    pub name: String,
    pub procs: Vec<Proc>,
    pub ports: Vec<u16>,
    pub memory: u64,
    pub cpu: f32,
    /// How long the oldest process has been running, in seconds.
    pub run_time: u64,
    /// Every process in the group was launched by Claude Code (MCP servers): the panel sets them aside.
    pub by_claude: bool,
}

/// The development runtimes the panel shows, by executable name.
const RUNTIMES: &[(&str, &str)] = &[
    ("node", "node"),
    ("bun", "bun"),
    ("deno", "deno"),
    ("python", "python"),
    ("python3", "python"),
    ("pythonw", "python"),
    ("py", "python"),
    ("uv", "python"),
    ("cargo", "cargo"),
    ("java", "java"),
    ("javaw", "java"),
    ("dotnet", "dotnet"),
    ("go", "go"),
    ("ruby", "ruby"),
    ("php", "php"),
];

/// The files that mark a project root.
const MARKERS: &[&str] = &["package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml", ".git"];

fn stem(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).to_string()
}

/// A process's runtime, or None if it is not a development process.
pub fn runtime_of(name: &str) -> Option<&'static str> {
    let s = stem(name);
    RUNTIMES.iter().find(|(exe, _)| *exe == s).map(|(_, rt)| *rt)
}

/// The tool launched by the runtime, from the arguments: `node .../npm-cli.js start` is npm,
/// `node .../node_modules/tsx/dist/cli.mjs` is tsx, `python -m uvicorn` is uvicorn.
pub fn tool_of(cmd: &[String]) -> Option<String> {
    for (i, arg) in cmd.iter().enumerate().skip(1) {
        let a = arg.replace('\\', "/");
        if a.ends_with("npm-cli.js") {
            return Some("npm".into());
        }
        if a.ends_with("npx-cli.js") {
            return Some("npx".into());
        }
        if a.contains("pnpm") && a.ends_with(".cjs") {
            return Some("pnpm".into());
        }
        if a.contains("claude-code") || a.ends_with("/claude") || a.ends_with("claude.js") {
            return Some("claude".into());
        }
        // The last package in the path: .../node_modules/.bin/../tsx/dist/cli.mjs -> tsx.
        if let Some(pos) = a.rfind("node_modules/") {
            let rest = &a[pos + "node_modules/".len()..];
            let mut parts = rest.split('/').filter(|p| !p.is_empty() && *p != ".bin" && *p != "..");
            if let Some(first) = parts.next() {
                let pkg = if first.starts_with('@') {
                    parts.next().map(|p| format!("{first}/{p}")).unwrap_or_else(|| first.to_string())
                } else {
                    first.to_string()
                };
                return Some(pkg);
            }
        }
        if a == "-m" {
            return cmd.get(i + 1).cloned();
        }
    }
    None
}

/// The project folder: the nearest one, walking up from `cwd`, with one of the MARKERS.
/// `has` tells whether a file exists (fake in tests).
pub fn project_root(cwd: &Path, has: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let mut dir = Some(cwd);
    while let Some(d) = dir {
        if MARKERS.iter().any(|m| has(&d.join(m))) {
            return Some(d.to_path_buf());
        }
        dir = d.parent();
    }
    None
}

/// Terminals and shells: between a process and whoever really launched it, they don't count.
const SHELLS: &[&str] = &["cmd", "powershell", "pwsh", "bash", "sh", "zsh", "conhost", "openconsole", "windowsterminal", "wt"];

/// The folder without the trailing slash.
fn trim_folder(p: &Path) -> String {
    p.to_string_lossy().trim_end_matches(['\\', '/']).to_string()
}

/// A folder's key: on Windows `C:\x\` and `c:\x` are the same.
fn folder_key(p: &Path) -> String {
    let s = trim_folder(p);
    if cfg!(windows) { s.to_lowercase() } else { s }
}

/// A readable command line, quoted where needed.
pub fn join_cmd(cmd: &[String]) -> String {
    cmd.iter()
        .map(|a| if a.contains(' ') && !a.starts_with('"') { format!("\"{a}\"") } else { a.clone() })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Filters the development processes and groups them by project.
///
/// A process without a readable folder goes into its development ancestor's
/// group, if there is one; otherwise into the "unknown folder" group.
/// `exclude` are the pids not to show (Dev Deck and its children).
pub fn group(all: &[RawProc], has: &dyn Fn(&Path) -> bool, exclude: &HashSet<u32>) -> Vec<Group> {
    let by_pid: HashMap<u32, &RawProc> = all.iter().map(|p| (p.pid, p)).collect();
    let dev: Vec<&RawProc> = all
        .iter()
        .filter(|p| runtime_of(&p.name).is_some() && !exclude.contains(&p.pid))
        .collect();
    let dev_pids: HashSet<u32> = dev.iter().map(|p| p.pid).collect();

    // The nearest development ancestor, skipping cmd.exe and the like (npm start on Windows
    // goes through cmd /c before launching node).
    let dev_ancestor = |p: &RawProc| -> Option<u32> {
        let mut seen = HashSet::new();
        let mut cur = p.parent;
        while let Some(pid) = cur {
            if !seen.insert(pid) {
                break;
            }
            if dev_pids.contains(&pid) {
                return Some(pid);
            }
            cur = by_pid.get(&pid).and_then(|q| q.parent);
        }
        None
    };

    // Each process's project root; without a folder, the ancestor's.
    let mut roots: HashMap<u32, Option<PathBuf>> = HashMap::new();
    fn root_of(
        p: &RawProc,
        has: &dyn Fn(&Path) -> bool,
        by_pid: &HashMap<u32, &RawProc>,
        ancestor: &dyn Fn(&RawProc) -> Option<u32>,
        memo: &mut HashMap<u32, Option<PathBuf>>,
        depth: usize,
    ) -> Option<PathBuf> {
        if let Some(r) = memo.get(&p.pid) {
            return r.clone();
        }
        let r = match &p.cwd {
            Some(cwd) => project_root(cwd, has).or_else(|| Some(cwd.clone())),
            None if depth < 32 => ancestor(p)
                .and_then(|a| by_pid.get(&a).copied())
                .and_then(|a| root_of(a, has, by_pid, ancestor, memo, depth + 1)),
            None => None,
        };
        memo.insert(p.pid, r.clone());
        r
    }

    // Who launched the process: the first ancestor that is neither a dev process nor a shell.
    let launcher_of = |p: &RawProc| -> Option<String> {
        let mut seen = HashSet::new();
        let mut cur = p.parent;
        while let Some(pid) = cur {
            if !seen.insert(pid) {
                return None;
            }
            let q = by_pid.get(&pid)?;
            let name = stem(&q.name);
            if !dev_pids.contains(&pid) && !SHELLS.contains(&name.as_str()) {
                return Some(name);
            }
            cur = q.parent;
        }
        None
    };

    // The Claude Code session it belongs to: the first `claude` ancestor.
    let claude_of = |p: &RawProc| -> Option<u32> {
        let mut seen = HashSet::new();
        let mut cur = p.parent;
        while let Some(pid) = cur {
            if !seen.insert(pid) {
                return None;
            }
            let q = by_pid.get(&pid)?;
            if stem(&q.name) == "claude" {
                return Some(pid);
            }
            cur = q.parent;
        }
        None
    };

    // By normalized key; the shown name is the first form seen, without trailing slash.
    let mut groups: BTreeMap<String, (String, Vec<&RawProc>)> = BTreeMap::new();
    for p in &dev {
        let root = root_of(p, has, &by_pid, &dev_ancestor, &mut roots, 0);
        let key = root.as_deref().map(folder_key).unwrap_or_default();
        let shown = root.as_deref().map(trim_folder).unwrap_or_default();
        groups.entry(key).or_insert_with(|| (shown, vec![])).1.push(p);
    }

    let mut out: Vec<Group> = groups
        .into_iter()
        .map(|(_, (key, members))| {
            let in_group: HashSet<u32> = members.iter().map(|p| p.pid).collect();
            // Depth in the group's tree: how many dev ancestors in the same group.
            let depth_of = |p: &RawProc| {
                let mut d = 0;
                let mut cur = dev_ancestor(p);
                while let Some(a) = cur {
                    if !in_group.contains(&a) || d > 32 {
                        break;
                    }
                    d += 1;
                    cur = by_pid.get(&a).and_then(|q| dev_ancestor(q));
                }
                d
            };
            // In tree order: each root followed by its descendants.
            let mut ordered: Vec<(&RawProc, usize)> = Vec::new();
            let mut roots: Vec<&&RawProc> = members.iter().filter(|p| depth_of(p) == 0).collect();
            roots.sort_by_key(|p| std::cmp::Reverse(p.run_time));
            fn visit<'a>(
                p: &'a RawProc,
                depth: usize,
                members: &[&'a RawProc],
                ancestor: &dyn Fn(&RawProc) -> Option<u32>,
                out: &mut Vec<(&'a RawProc, usize)>,
            ) {
                out.push((p, depth));
                for c in members.iter().filter(|c| ancestor(c) == Some(p.pid)) {
                    if depth < 32 {
                        visit(c, depth + 1, members, ancestor, out);
                    }
                }
            }
            for r in roots {
                visit(r, 0, &members, &dev_ancestor, &mut ordered);
            }
            // Whatever is left out (cycles, odd data) goes at the end, so nothing disappears.
            let placed: HashSet<u32> = ordered.iter().map(|(p, _)| p.pid).collect();
            for p in &members {
                if !placed.contains(&p.pid) {
                    ordered.push((p, 0));
                }
            }

            let procs: Vec<Proc> = ordered
                .into_iter()
                .map(|(p, depth)| {
                    let tool = tool_of(&p.cmd);
                    Proc {
                        launcher: launcher_of(p),
                        parent_alive: p.parent.is_some_and(|x| by_pid.contains_key(&x)),
                        claude_pid: claude_of(p),
                        pid: p.pid,
                        parent: p.parent,
                        runtime: runtime_of(&p.name).unwrap_or("?").to_string(),
                        claude: tool.as_deref() == Some("claude"),
                        tool,
                        cmd: join_cmd(&p.cmd),
                        cwd: p.cwd.as_ref().map(|c| c.to_string_lossy().to_string()),
                        memory: p.memory,
                        cpu: p.cpu,
                        run_time: p.run_time,
                        ports: p.ports.clone(),
                        depth,
                    }
                })
                .collect();
            let mut ports: Vec<u16> = procs.iter().flat_map(|p| p.ports.clone()).collect();
            ports.sort_unstable();
            ports.dedup();
            let name = if key.is_empty() {
                "unknown folder".to_string()
            } else {
                Path::new(&key).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| key.clone())
            };
            Group {
                by_claude: procs.iter().all(|p| p.launcher.as_deref() == Some("claude")),
                root: if key.is_empty() { None } else { Some(key) },
                name,
                memory: procs.iter().map(|p| p.memory).sum(),
                cpu: procs.iter().map(|p| p.cpu).sum(),
                run_time: procs.iter().map(|p| p.run_time).max().unwrap_or(0),
                ports,
                procs,
            }
        })
        .collect();
    // Your projects first, then Claude Code's; within each, those with an open port first, then by name.
    out.sort_by(|a, b| {
        a.by_claude
            .cmp(&b.by_claude)
            .then(a.ports.is_empty().cmp(&b.ports.is_empty()))
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

/* ---------- reading the system ---------- */

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// The listening TCP ports, by pid.
pub fn listening_ports() -> HashMap<u32, Vec<u16>> {
    use netstat2::{get_sockets_info, AddressFamilyFlags, ProtocolFlags, ProtocolSocketInfo, TcpState};
    let mut out: HashMap<u32, Vec<u16>> = HashMap::new();
    let Ok(sockets) = get_sockets_info(AddressFamilyFlags::IPV4 | AddressFamilyFlags::IPV6, ProtocolFlags::TCP) else {
        return out;
    };
    for s in sockets {
        if let ProtocolSocketInfo::Tcp(t) = &s.protocol_socket_info {
            if t.state == TcpState::Listen {
                for pid in &s.associated_pids {
                    let ports = out.entry(*pid).or_default();
                    if !ports.contains(&t.local_port) {
                        ports.push(t.local_port);
                    }
                }
            }
        }
    }
    for ports in out.values_mut() {
        ports.sort_unstable();
    }
    out
}

pub fn refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_cpu()
        .with_memory()
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .with_cwd(UpdateKind::OnlyIfNotSet)
        .with_exe(UpdateKind::OnlyIfNotSet)
}

/// All processes, read now. `sys` stays alive between reads:
/// CPU is measured as the difference between two reads.
pub fn snapshot(sys: &mut System) -> Vec<RawProc> {
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, refresh_kind());
    let ports = listening_ports();
    sys.processes()
        .values()
        .map(|p| RawProc {
            pid: p.pid().as_u32(),
            parent: p.parent().map(|x| x.as_u32()),
            name: p.name().to_string_lossy().to_string(),
            cmd: p.cmd().iter().map(|a| a.to_string_lossy().to_string()).collect(),
            cwd: p.cwd().map(|c| c.to_path_buf()),
            memory: p.memory(),
            cpu: p.cpu_usage(),
            run_time: p.run_time(),
            ports: ports.get(&p.pid().as_u32()).cloned().unwrap_or_default(),
        })
        .collect()
}

/// Dev Deck and all its descendants: never shown, never touched.
pub fn own_tree(all: &[RawProc]) -> HashSet<u32> {
    let me = std::process::id();
    let mut out = HashSet::from([me]);
    loop {
        let before = out.len();
        for p in all {
            if p.parent.is_some_and(|x| out.contains(&x)) {
                out.insert(p.pid);
            }
        }
        if out.len() == before {
            return out;
        }
    }
}

pub fn pid(n: u32) -> Pid {
    Pid::from_u32(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(pid: u32, parent: Option<u32>, name: &str, cmd: &[&str], cwd: Option<&str>) -> RawProc {
        RawProc {
            pid,
            parent,
            name: name.into(),
            cmd: cmd.iter().map(|s| s.to_string()).collect(),
            cwd: cwd.map(PathBuf::from),
            memory: 100,
            cpu: 1.0,
            run_time: 1000 - pid as u64,
            ports: vec![],
        }
    }

    /// A fake disk: the projects are acme-shop/backend and dev-deck.
    fn has(path: &Path) -> bool {
        let s = path.to_string_lossy().replace('\\', "/");
        ["C:/d/acme-shop/backend/package.json", "C:/d/acme-shop/.git", "C:/d/dev-deck/package.json"].contains(&s.as_str())
    }

    /// This machine's real groups: `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn print_the_machine() {
        let mut sys = System::new();
        snapshot(&mut sys);
        std::thread::sleep(std::time::Duration::from_millis(500));
        let all = snapshot(&mut sys);
        for g in group(&all, &|p| p.exists(), &own_tree(&all)) {
            println!("{} {:?} ports {:?} {} MB", g.name, g.root, g.ports, g.memory / 1_048_576);
            for p in &g.procs {
                let cmd: String = p.cmd.chars().take(90).collect();
                println!("   {}{} {} [{}] {}", "  ".repeat(p.depth), p.pid, p.runtime, p.tool.clone().unwrap_or_default(), cmd);
            }
        }
    }

    #[test]
    fn recognizes_runtimes_and_tools() {
        assert_eq!(runtime_of("node.exe"), Some("node"));
        assert_eq!(runtime_of("Python3"), Some("python"));
        assert_eq!(runtime_of("chrome.exe"), None);
        let tsx = ["node", r"C:\d\acme-shop\backend\node_modules\.bin\..\tsx\dist\cli.mjs", "src/index.ts"].map(String::from);
        assert_eq!(tool_of(&tsx).as_deref(), Some("tsx"));
        let npm = ["node", r"C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js", "start"].map(String::from);
        assert_eq!(tool_of(&npm).as_deref(), Some("npm"));
        let scoped = ["node", "/x/node_modules/@tauri-apps/cli/tauri.js", "dev"].map(String::from);
        assert_eq!(tool_of(&scoped).as_deref(), Some("@tauri-apps/cli"));
        let uv = ["python", "-m", "uvicorn", "app:app"].map(String::from);
        assert_eq!(tool_of(&uv).as_deref(), Some("uvicorn"));
    }

    #[test]
    fn root_is_nearest_folder_with_a_marker() {
        assert_eq!(project_root(Path::new("C:/d/acme-shop/backend/src"), &has), Some(PathBuf::from("C:/d/acme-shop/backend")));
        assert_eq!(project_root(Path::new("C:/d/acme-shop/extension"), &has), Some(PathBuf::from("C:/d/acme-shop")));
        assert_eq!(project_root(Path::new("C:/other"), &has), None);
    }

    #[test]
    fn groups_by_project_through_cmd_exe() {
        // npm start on Windows: node(npm) -> cmd.exe -> node(tsx) -> node(index.ts), port 8792.
        let mut index = p(13, Some(12), "node.exe", &["node", "--import", "tsx", "src/index.ts"], Some("C:/d/acme-shop/backend"));
        index.ports = vec![8792];
        let all = vec![
            p(1, None, "explorer.exe", &["explorer"], None),
            p(10, Some(1), "node.exe", &["node", r"C:\nodejs\node_modules\npm\bin\npm-cli.js", "start"], Some("C:/d/acme-shop/backend")),
            p(11, Some(10), "cmd.exe", &["cmd", "/c", "tsx src/index.ts"], Some("C:/d/acme-shop/backend")),
            p(12, Some(11), "node.exe", &["node", "C:/d/acme-shop/backend/node_modules/tsx/dist/cli.mjs", "src/index.ts"], None),
            index,
            p(20, Some(1), "node.exe", &["node", "vite"], Some("C:/d/dev-deck/ui")),
            p(30, Some(1), "chrome.exe", &["chrome"], Some("C:/d/acme-shop/backend")),
        ];
        let groups = group(&all, &has, &HashSet::new());
        assert_eq!(groups.len(), 2);
        let tt = &groups[0];
        assert_eq!(tt.name, "backend");
        assert_eq!(tt.ports, vec![8792]);
        // In tree order, cmd.exe skipped but the parentage kept.
        let order: Vec<(u32, usize)> = tt.procs.iter().map(|p| (p.pid, p.depth)).collect();
        assert_eq!(order, vec![(10, 0), (12, 1), (13, 2)]);
        assert_eq!(tt.procs[0].tool.as_deref(), Some("npm"));
        // The child without a readable folder stays with its parent.
        assert_eq!(tt.procs[1].cwd, None);
        assert_eq!(groups[1].name, "dev-deck");
    }

    #[test]
    fn same_folder_with_different_case_and_claude_mcp() {
        let all = vec![
            p(1, None, "claude.exe", &["claude"], Some("C:/d/acme-shop/backend")),
            p(2, Some(1), "node.exe", &["node", "npx-cli.js", "@playwright/mcp"], Some("C:/d/acme-shop/backend/")),
            p(3, None, "node.exe", &["node", "src/index.ts"], Some("c:/d/acme-shop/backend")),
        ];
        let has_ci = |path: &Path| has(Path::new(&path.to_string_lossy().replace("c:/", "C:/")));
        let groups = group(&all, &has_ci, &HashSet::new());
        if cfg!(windows) {
            assert_eq!(groups.len(), 1, "{groups:?}");
            assert!(!groups[0].by_claude);
        }
        let mcp = groups.iter().flat_map(|g| &g.procs).find(|x| x.pid == 2).unwrap();
        assert_eq!(mcp.launcher.as_deref(), Some("claude"));
        let only_mcp = group(&all[..2], &has, &HashSet::new());
        assert!(only_mcp[0].by_claude);
    }

    /// Claude Code sessions (claude.exe) are not development processes: they
    /// never enter the groups, so cleanup (which works on groups) never sees them.
    #[test]
    fn claude_code_sessions_stay_out_of_groups_and_cleanup() {
        assert_eq!(runtime_of("claude.exe"), None);
        let all = vec![
            p(1, None, "claude.exe", &["claude", "--resume", "x"], Some("C:/d/acme-shop/backend")),
            p(2, Some(1), "node.exe", &["node", "npx-cli.js", "@playwright/mcp"], Some("C:/d/acme-shop/backend")),
        ];
        let groups = group(&all, &has, &HashSet::new());
        assert!(groups.iter().flat_map(|g| &g.procs).all(|x| x.pid != 1));
        assert_eq!(groups[0].procs[0].claude_pid, Some(1));
    }

    #[test]
    fn excludes_dev_deck_and_marks_claude() {
        let all = vec![
            p(5, None, "node.exe", &["node", "C:/npm/node_modules/@anthropic-ai/claude-code/cli.js"], Some("C:/d/acme-shop/backend")),
            p(6, None, "node.exe", &["node", "x.js"], Some("C:/d/acme-shop/backend")),
        ];
        let groups = group(&all, &has, &HashSet::from([6]));
        assert_eq!(groups[0].procs.len(), 1);
        assert!(groups[0].procs[0].claude);
    }
}
