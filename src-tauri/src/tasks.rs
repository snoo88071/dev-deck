//! The scheduled tasks (Task Scheduler) that run something in a project, grouped by project.
//!
//! As in procs.rs, reading the system (`read`, the COM API) is kept apart from the logic
//! (`group`): the logic works on `RawTask` and is tested with fake tasks.
//!
//! A task belongs to a project when its working folder, its script or its program sits in
//! one. A task whose folder or script no longer exists is kept too, grouped under that
//! folder: it runs on a schedule and fails every time, which is the case worth seeing.

use crate::procs::{self, project_root};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

/// A task as the system reads it.
#[derive(Clone, Debug, Default)]
pub struct RawTask {
    /// The full path in the Task Scheduler, e.g. `\Dev Deck\nightly`: the task's id.
    pub path: String,
    pub name: String,
    pub enabled: bool,
    pub running: bool,
    /// Only `exec` actions (the others are COM handlers, e-mails...).
    pub actions: Vec<RawAction>,
    pub triggers: Vec<Trigger>,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    /// The last run's result: 0 is ok, an HRESULT or the program's exit code otherwise.
    pub last_result: u32,
    /// The pids of the running instances: the action's own process.
    pub pids: Vec<u32>,
    pub author: Option<String>,
    pub description: Option<String>,
}

/// An `exec` action, with the environment variables already expanded.
#[derive(Clone, Debug, Default)]
pub struct RawAction {
    pub exe: String,
    pub args: String,
    pub workdir: Option<String>,
}

/// When a task runs.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
pub struct Trigger {
    /// once, daily, weekly, monthly, logon, boot, idle, event, other.
    pub kind: String,
    /// The first run, local time `YYYY-MM-DDTHH:MM:SS`: its time of day is the schedule's.
    pub start: Option<String>,
    /// Every N days (daily) or weeks (weekly); 1 otherwise.
    pub every: u32,
    /// Weekly: the days, 0 = Sunday.
    pub days: Vec<u8>,
    /// Repeats every N minutes from the start, if set.
    pub repeat_minutes: Option<u32>,
    pub enabled: bool,
}

/// A task as the panel sees it.
#[derive(Clone, Debug, Serialize)]
pub struct Job {
    pub path: String,
    pub name: String,
    /// The Task Scheduler folder: `\` or `\Dev Deck\`.
    pub folder: String,
    pub enabled: bool,
    pub running: bool,
    /// What it runs, readable (without the `conhost --headless` in front).
    pub cmd: String,
    /// powershell, node, python, cmd... or the program's name.
    pub runtime: String,
    /// The script it runs, absolute, if it can be told.
    pub script: Option<String>,
    pub workdir: Option<String>,
    /// The folder or script that no longer exists: the task can only fail.
    pub missing: Option<String>,
    pub triggers: Vec<Trigger>,
    pub last_run: Option<String>,
    pub next_run: Option<String>,
    pub last_result: u32,
    /// The last result in words the panel translates: see `result_kind`.
    pub result: &'static str,
    pub pids: Vec<u32>,
    pub author: Option<String>,
    pub description: Option<String>,
}

/// The tasks of one project.
#[derive(Clone, Debug, Serialize)]
pub struct JobGroup {
    /// The project folder (or the missing folder the tasks point to).
    pub root: String,
    pub name: String,
    pub jobs: Vec<Job>,
}

/// The extensions of the scripts a task can run.
const SCRIPTS: &[&str] = &["ps1", "py", "pyw", "js", "mjs", "cjs", "ts", "mts", "cts", "bat", "cmd", "sh", "rb", "php"];

/// Programs that only host the real one: their folder says nothing about the project.
const HOSTS: &[&str] = &["cmd", "powershell", "pwsh", "conhost", "wscript", "cscript", "bash", "sh", "wsl"];

fn stem(path: &str) -> String {
    let name = Path::new(path).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

fn is_script(s: &str) -> bool {
    Path::new(s).extension().is_some_and(|e| SCRIPTS.contains(&e.to_string_lossy().to_lowercase().as_str()))
}

/// Splits a Windows command line: spaces separate, double quotes group (and go away).
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = vec![];
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => cur.push(c),
        }
    }
    if any || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Replaces `%NAME%` with the variable's value; unknown names stay as they are.
pub fn expand_env(s: &str, var: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) if j > 0 && !after[..j].contains(char::is_whitespace) => {
                match var(&after[..j]) {
                    Some(v) => out.push_str(&v),
                    None => out.push_str(&rest[i..i + j + 2]),
                }
                rest = &after[j + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// The real command: `conhost --headless node x.js` runs `node x.js`.
fn real_command(action: &RawAction) -> Vec<String> {
    let mut cmd = vec![action.exe.trim_matches('"').to_string()];
    cmd.extend(split_args(&action.args));
    if stem(&cmd[0]) == "conhost" {
        let skip = cmd.iter().skip(1).take_while(|a| a.starts_with("--")).count();
        if cmd.len() > 1 + skip {
            return cmd.split_off(1 + skip);
        }
    }
    cmd
}

/// The script a command runs: `-File x.ps1` for PowerShell, otherwise the first
/// argument with a script's extension (also inside `-Command "& 'x.ps1'"`), or the
/// program itself when it is a script.
fn script_of(cmd: &[String]) -> Option<String> {
    if is_script(&cmd[0]) {
        return Some(cmd[0].clone());
    }
    if let Some(i) = cmd.iter().position(|a| a.eq_ignore_ascii_case("-file") || a.eq_ignore_ascii_case("-f")) {
        if let Some(f) = cmd.get(i + 1) {
            return Some(f.clone());
        }
    }
    cmd.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .flat_map(|a| a.split_whitespace())
        .map(|w| w.trim_matches(|c| matches!(c, '\'' | '"' | '&' | ';' | '(' | ')')))
        .find(|w| is_script(w))
        .map(str::to_string)
}

/// Relative paths are relative to the task's working folder. On Windows with `\` only.
fn absolute(p: &str, workdir: Option<&str>) -> String {
    let out = match workdir {
        Some(w) if Path::new(p).is_relative() => Path::new(w).join(p).to_string_lossy().to_string(),
        _ => p.to_string(),
    };
    if cfg!(windows) { out.replace('/', "\\") } else { out }
}

fn runtime_name(exe: &str) -> String {
    let s = stem(exe);
    match s.as_str() {
        "pwsh" => "powershell".into(),
        _ => procs::runtime_of(&s).map(str::to_string).unwrap_or(s),
    }
}

/// The folder the task scheduler groups by: `\a\b` is in `\a\`.
fn folder_of(path: &str) -> String {
    match path.rfind('\\') {
        Some(i) => path[..=i].to_string(),
        None => "\\".into(),
    }
}

fn trim(p: &Path) -> String {
    p.to_string_lossy().trim_end_matches(['\\', '/']).to_string()
}

/// The tasks that run something in a project, grouped by project. `has` tells whether
/// a file or folder exists (fake in tests). Windows's own tasks (`\Microsoft\`) never enter.
pub fn group(tasks: &[RawTask], has: &dyn Fn(&Path) -> bool) -> Vec<JobGroup> {
    let mut groups: BTreeMap<String, (String, Vec<Job>)> = BTreeMap::new();
    for t in tasks {
        if t.path.to_lowercase().starts_with("\\microsoft\\") {
            continue;
        }
        let Some(action) = t.actions.first() else { continue };
        let cmd = real_command(action);
        let workdir = action.workdir.as_deref().map(|w| w.trim_matches('"')).filter(|w| !w.is_empty());
        let script = script_of(&cmd).map(|s| absolute(&s, workdir));
        let exe = &cmd[0];

        // Where to look for the project: the working folder, the script's, the program's
        // (not for runtimes and shells: node.exe's folder is not a project).
        let mut places: Vec<PathBuf> = vec![];
        places.extend(workdir.map(PathBuf::from));
        places.extend(script.as_deref().and_then(|s| Path::new(s).parent()).map(Path::to_path_buf));
        let hosted = HOSTS.contains(&stem(exe).as_str()) || procs::runtime_of(&stem(exe)).is_some();
        if !hosted && Path::new(exe).is_absolute() {
            places.extend(Path::new(exe).parent().map(Path::to_path_buf));
        }

        let missing = workdir
            .filter(|w| !has(Path::new(w)))
            .map(str::to_string)
            .or_else(|| script.clone().filter(|s| !has(Path::new(s))));
        let root = places
            .iter()
            .find_map(|p| project_root(p, has))
            .or_else(|| missing.as_ref().and_then(|_| places.first().cloned()));
        let Some(root) = root else { continue };

        let job = Job {
            path: t.path.clone(),
            name: t.name.clone(),
            folder: folder_of(&t.path),
            enabled: t.enabled,
            running: t.running,
            cmd: procs::join_cmd(&cmd),
            runtime: runtime_name(exe),
            script,
            workdir: workdir.map(str::to_string),
            missing,
            triggers: t.triggers.clone(),
            last_run: t.last_run.clone(),
            next_run: t.next_run.clone(),
            last_result: t.last_result,
            result: result_kind(t.last_result),
            pids: t.pids.clone(),
            author: t.author.clone(),
            description: t.description.clone(),
        };
        let shown = trim(&root);
        let key = if cfg!(windows) { shown.to_lowercase() } else { shown.clone() };
        groups.entry(key).or_insert_with(|| (shown, vec![])).1.push(job);
    }
    let mut out: Vec<JobGroup> = groups
        .into_values()
        .map(|(root, mut jobs)| {
            jobs.sort_by_key(|j| j.name.to_lowercase());
            let name = Path::new(&root).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.clone());
            JobGroup { root, name, jobs }
        })
        .collect();
    out.sort_by_key(|g| g.name.to_lowercase());
    out
}

/// A task's path is one Dev Deck may touch: it is still among the project tasks.
fn allowed<'a>(groups: &'a [JobGroup], path: &str) -> Result<&'a Job, String> {
    groups
        .iter()
        .flat_map(|g| &g.jobs)
        .find(|j| j.path.eq_ignore_ascii_case(path))
        .ok_or_else(|| format!("{path} is not a project task (or it is gone)"))
}

/* ---------- small conversions, tested ---------- */

/// An OLE date (days since 1899-12-30, local time) as `YYYY-MM-DDTHH:MM:SS`.
/// The Task Scheduler says "never" with dates before 2000 (1999-11-30).
pub fn ole_date(d: f64) -> Option<String> {
    let secs = (d * 86400.0).round() as i64 - 25569 * 86400;
    let (days, rem) = (secs.div_euclid(86400), secs.rem_euclid(86400));
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    if year < 2000 {
        return None;
    }
    Some(format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}", rem / 3600, rem / 60 % 60, rem % 60))
}

/// An ISO 8601 duration (`PT48H`, `P2D`, `PT1H30M`) in minutes.
pub fn duration_minutes(s: &str) -> Option<u32> {
    let s = s.strip_prefix('P')?;
    let (mut total, mut num, mut time) = (0u32, String::new(), false);
    for c in s.chars() {
        match c {
            'T' => time = true,
            '0'..='9' => num.push(c),
            _ => {
                let n: u32 = num.parse().ok()?;
                num.clear();
                total += match (c, time) {
                    ('D', false) => n * 1440,
                    ('W', false) => n * 7 * 1440,
                    ('H', true) => n * 60,
                    ('M', true) => n,
                    ('S', true) => 0,
                    _ => return None,
                };
            }
        }
    }
    (total > 0).then_some(total)
}

/// A task's last result as a kind: ok, running, not-run, terminated, folder-missing,
/// file-missing, path-missing, denied, refused, exit (a program's exit code), error (anything else).
pub fn result_kind(code: u32) -> &'static str {
    match code {
        0 => "ok",
        0x41301 => "running",
        0x41300 | 0x41303 => "not-run",
        0x41306 => "terminated",
        0x8007_010B => "folder-missing",
        0x8007_0002 => "file-missing",
        0x8007_0003 => "path-missing",
        0x8007_0005 => "denied",
        0x8007_10E0 => "refused",
        c if c <= 0xFFFF => "exit",
        _ => "error",
    }
}

/// Weekdays from the Task Scheduler's bit mask (1 = Sunday ... 64 = Saturday).
pub fn weekdays(mask: i16) -> Vec<u8> {
    (0..7).filter(|d| mask & (1 << d) != 0).collect()
}

/* ---------- reading the system (Windows, COM) ---------- */

#[cfg(windows)]
mod com {
    use super::*;
    use windows::core::{Interface, BSTR};
    use windows::Win32::Foundation::{VARIANT_BOOL, VARIANT_FALSE, VARIANT_TRUE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::System::TaskScheduler::*;
    use windows::Win32::System::Variant::{VARIANT, VT_I4};

    fn index(n: i32) -> VARIANT {
        let mut v = VARIANT::default();
        // SAFETY: a VT_I4 VARIANT holds its value in lVal; nothing to free.
        unsafe {
            (*v.Anonymous.Anonymous).vt = VT_I4;
            (*v.Anonymous.Anonymous).Anonymous.lVal = n;
        }
        v
    }

    fn text(get: impl FnOnce(*mut BSTR) -> windows::core::Result<()>) -> Option<String> {
        let mut b = BSTR::new();
        get(&mut b).ok()?;
        let s = b.to_string();
        (!s.trim().is_empty()).then_some(s)
    }

    fn env(name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    /// Runs `f` on a thread of its own with COM initialized: the caller's thread
    /// (Tauri's, the webview's) may have COM set up differently.
    pub fn with_service<T: Send + 'static>(f: impl FnOnce(&ITaskService) -> Result<T, String> + Send + 'static) -> Result<T, String> {
        std::thread::spawn(move || unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| e.to_string())?;
            let out = (|| {
                let service: ITaskService = CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
                let empty = VARIANT::default();
                service.Connect(&empty, &empty, &empty, &empty).map_err(|e| e.to_string())?;
                f(&service)
            })();
            CoUninitialize();
            out
        })
        .join()
        .map_err(|_| "the Task Scheduler reader crashed".to_string())?
    }

    unsafe fn trigger(t: &ITrigger) -> Trigger {
        let mut kind = TASK_TRIGGER_TYPE2::default();
        let _ = t.Type(&mut kind);
        let mut enabled = VARIANT_BOOL::default();
        let _ = t.Enabled(&mut enabled);
        let mut out = Trigger {
            kind: match kind {
                TASK_TRIGGER_TIME => "once",
                TASK_TRIGGER_DAILY => "daily",
                TASK_TRIGGER_WEEKLY => "weekly",
                TASK_TRIGGER_MONTHLY | TASK_TRIGGER_MONTHLYDOW => "monthly",
                TASK_TRIGGER_LOGON => "logon",
                TASK_TRIGGER_BOOT => "boot",
                TASK_TRIGGER_IDLE => "idle",
                TASK_TRIGGER_EVENT => "event",
                _ => "other",
            }
            .into(),
            // `2026-09-02T07:00:00+02:00`: the local time is the first 19 characters.
            start: text(|b| t.StartBoundary(b)).map(|s| s.chars().take(19).collect()),
            every: 1,
            days: vec![],
            repeat_minutes: t.Repetition().ok().and_then(|r| text(|b| r.Interval(b))).and_then(|i| duration_minutes(&i)),
            enabled: enabled != VARIANT_FALSE,
        };
        if let Ok(d) = t.cast::<IDailyTrigger>() {
            let mut n = 1i16;
            let _ = d.DaysInterval(&mut n);
            out.every = n.max(1) as u32;
        }
        if let Ok(w) = t.cast::<IWeeklyTrigger>() {
            let (mut n, mut mask) = (1i16, 0i16);
            let _ = w.WeeksInterval(&mut n);
            let _ = w.DaysOfWeek(&mut mask);
            out.every = n.max(1) as u32;
            out.days = weekdays(mask);
        }
        out
    }

    unsafe fn task(t: &IRegisteredTask) -> Option<RawTask> {
        let def = t.Definition().ok()?;
        let actions = def.Actions().ok()?;
        let mut n = 0;
        let _ = actions.Count(&mut n);
        let mut raw_actions = vec![];
        for i in 1..=n {
            let Ok(a) = actions.get_Item(i) else { continue };
            let mut kind = TASK_ACTION_TYPE::default();
            let _ = a.Type(&mut kind);
            if kind != TASK_ACTION_EXEC {
                continue;
            }
            let Ok(e) = a.cast::<IExecAction>() else { continue };
            let exe = text(|b| e.Path(b)).unwrap_or_default();
            raw_actions.push(RawAction {
                exe: expand_env(&exe, &env),
                args: expand_env(&text(|b| e.Arguments(b)).unwrap_or_default(), &env),
                workdir: text(|b| e.WorkingDirectory(b)).map(|w| expand_env(&w, &env)),
            });
        }
        if raw_actions.is_empty() {
            return None;
        }
        let mut triggers = vec![];
        if let Ok(ts) = def.Triggers() {
            let mut n = 0;
            let _ = ts.Count(&mut n);
            for i in 1..=n {
                if let Ok(tr) = ts.get_Item(i) {
                    triggers.push(trigger(&tr));
                }
            }
        }
        let info = def.RegistrationInfo().ok();
        let mut pids = vec![];
        if let Ok(running) = t.GetInstances(0) {
            for i in 1..=running.Count().unwrap_or(0) {
                if let Ok(pid) = running.get_Item(&index(i)).and_then(|r| r.EnginePID()) {
                    pids.push(pid);
                }
            }
        }
        Some(RawTask {
            path: t.Path().ok()?.to_string(),
            name: t.Name().ok()?.to_string(),
            enabled: t.Enabled().is_ok_and(|e| e != VARIANT_FALSE),
            running: t.State().is_ok_and(|s| s == TASK_STATE_RUNNING),
            actions: raw_actions,
            triggers,
            last_run: t.LastRunTime().ok().and_then(ole_date),
            next_run: t.NextRunTime().ok().and_then(ole_date),
            last_result: t.LastTaskResult().unwrap_or(0) as u32,
            pids,
            author: info.as_ref().and_then(|i| text(|b| i.Author(b))),
            description: info.as_ref().and_then(|i| text(|b| i.Description(b))),
        })
    }

    /// Every task with an `exec` action, in every folder. Folders or tasks this user
    /// can't read are skipped.
    pub fn read(service: &ITaskService) -> Result<Vec<RawTask>, String> {
        let mut out = vec![];
        unsafe {
            let root = service.GetFolder(&BSTR::from("\\")).map_err(|e| e.to_string())?;
            let mut stack = vec![root];
            while let Some(folder) = stack.pop() {
                if let Ok(tasks) = folder.GetTasks(TASK_ENUM_HIDDEN.0) {
                    for i in 1..=tasks.Count().unwrap_or(0) {
                        if let Some(t) = tasks.get_Item(&index(i)).ok().and_then(|t| task(&t)) {
                            out.push(t);
                        }
                    }
                }
                if let Ok(subs) = folder.GetFolders(0) {
                    for i in 1..=subs.Count().unwrap_or(0) {
                        if let Ok(f) = subs.get_Item(&index(i)) {
                            // Windows's own folder is huge and never shown: skip it whole.
                            if f.Path().is_ok_and(|p| p.to_string().eq_ignore_ascii_case("\\Microsoft")) {
                                continue;
                            }
                            stack.push(f);
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    /// The running tasks' own processes: pid → task name. Every task, not only project
    /// ones: a dev process started by any task is that task's.
    pub fn engines(service: &ITaskService) -> Result<Vec<(u32, String)>, String> {
        let mut out = vec![];
        unsafe {
            let running = service.GetRunningTasks(TASK_ENUM_HIDDEN.0).map_err(|e| e.to_string())?;
            for i in 1..=running.Count().unwrap_or(0) {
                if let Ok(r) = running.get_Item(&index(i)) {
                    if let (Ok(pid), Ok(name)) = (r.EnginePID(), r.Name()) {
                        if pid != 0 {
                            out.push((pid, name.to_string()));
                        }
                    }
                }
            }
        }
        Ok(out)
    }

    /// Keeps `store` fed with the running tasks' processes, every `every`, on a thread of
    /// its own with one connection kept open (opening it is what costs: ~40 ms).
    pub fn watch_engines(every: std::time::Duration, store: impl Fn(Vec<(u32, String)>) + Send + 'static) {
        std::thread::spawn(move || unsafe {
            if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
                return;
            }
            let mut service: Option<ITaskService> = None;
            loop {
                if service.is_none() {
                    service = CoCreateInstance(&TaskScheduler, None, CLSCTX_INPROC_SERVER).ok().filter(|s: &ITaskService| {
                        let empty = VARIANT::default();
                        s.Connect(&empty, &empty, &empty, &empty).is_ok()
                    });
                }
                match service.as_ref().map(engines) {
                    Some(Ok(list)) => store(list),
                    // The service went away (restart, sleep): connect again next time.
                    _ => service = None,
                }
                std::thread::sleep(every);
            }
        });
    }

    pub fn registered(service: &ITaskService, path: &str) -> Result<IRegisteredTask, String> {
        let (folder, name) = path.rsplit_once('\\').ok_or("invalid task path")?;
        let folder = if folder.is_empty() { "\\" } else { folder };
        unsafe {
            service
                .GetFolder(&BSTR::from(folder))
                .and_then(|f| f.GetTask(&BSTR::from(name)))
                .map_err(|e| e.to_string())
        }
    }

    pub fn run(t: &IRegisteredTask) -> Result<(), String> {
        unsafe { t.Run(&VARIANT::default()).map(|_| ()).map_err(|e| e.to_string()) }
    }

    pub fn set_enabled(t: &IRegisteredTask, on: bool) -> Result<(), String> {
        unsafe { t.SetEnabled(if on { VARIANT_TRUE } else { VARIANT_FALSE }).map_err(|e| e.to_string()) }
    }

    pub fn xml(t: &IRegisteredTask) -> Result<String, String> {
        unsafe { t.Xml().map(|x| x.to_string()).map_err(|e| e.to_string()) }
    }

    pub fn delete(service: &ITaskService, path: &str) -> Result<(), String> {
        let (folder, name) = path.rsplit_once('\\').ok_or("invalid task path")?;
        let folder = if folder.is_empty() { "\\" } else { folder };
        unsafe {
            service
                .GetFolder(&BSTR::from(folder))
                .and_then(|f| f.DeleteTask(&BSTR::from(name), 0))
                .map_err(|e| e.to_string())
        }
    }
}

/// The project tasks on this machine, grouped by project.
#[cfg(windows)]
pub fn jobs() -> Result<Vec<JobGroup>, String> {
    let raw = com::with_service(|s| com::read(s))?;
    Ok(group(&raw, &|p| p.exists()))
}

#[cfg(not(windows))]
pub fn jobs() -> Result<Vec<JobGroup>, String> {
    Ok(vec![])
}

/// The running tasks' processes (pid → task name), read now; empty if the Task Scheduler
/// can't be read. For one-off reads (the CLI); the panel uses `watched_engines`.
#[cfg(windows)]
pub fn engines() -> HashMap<u32, String> {
    com::with_service(|s| com::engines(s)).map(|v| v.into_iter().collect()).unwrap_or_default()
}

#[cfg(not(windows))]
pub fn engines() -> HashMap<u32, String> {
    Default::default()
}

static WATCHED: std::sync::Mutex<Option<HashMap<u32, String>>> = std::sync::Mutex::new(None);

/// Starts reading the running tasks every 5 s in the background (the panel refreshes
/// processes every 3 s: reading them there would hold it up).
pub fn watch_engines() {
    #[cfg(windows)]
    com::watch_engines(std::time::Duration::from_secs(5), |list| {
        *WATCHED.lock().unwrap_or_else(|e| e.into_inner()) = Some(list.into_iter().collect());
    });
}

/// The last background read of the running tasks.
pub fn watched_engines() -> HashMap<u32, String> {
    WATCHED.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_default()
}

/// What can be done to a task from Dev Deck. Each checks again that the task is a
/// project task: the panel's list may be old.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Act {
    Run,
    Enable,
    Disable,
}

#[cfg(windows)]
pub fn act(path: &str, act: Act) -> Result<(), String> {
    allowed(&jobs()?, path)?;
    let path = path.to_string();
    com::with_service(move |s| {
        let t = com::registered(s, &path)?;
        match act {
            Act::Run => com::run(&t),
            Act::Enable => com::set_enabled(&t, true),
            Act::Disable => com::set_enabled(&t, false),
        }
    })
}

/// Deletes a task, after saving its definition in `~/.dev-deck/deleted-tasks/`
/// (it goes back with `schtasks /create /tn <name> /xml <file>`). Returns the file.
#[cfg(windows)]
pub fn delete(path: &str) -> Result<String, String> {
    allowed(&jobs()?, path)?;
    let dir = std::env::var("DEVDECK_DELETED_TASKS").map(PathBuf::from).unwrap_or_else(|_| crate::describe::dir().join("deleted-tasks"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = path.to_string();
    com::with_service(move |s| {
        let t = com::registered(s, &path)?;
        let xml = com::xml(&t)?;
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let safe: String = path.trim_start_matches('\\').chars().map(|c| if c.is_alphanumeric() || " -_.".contains(c) { c } else { '_' }).collect();
        let file = dir.join(format!("{safe}-{stamp}.xml"));
        // The Task Scheduler's XML declares UTF-16: write it so, or schtasks refuses it.
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
        std::fs::write(&file, bytes).map_err(|e| format!("could not save the copy, nothing deleted: {e}"))?;
        com::delete(s, &path)?;
        Ok(file.to_string_lossy().to_string())
    })
}

#[cfg(not(windows))]
pub fn act(_path: &str, _act: Act) -> Result<(), String> {
    Err("scheduled tasks are Windows only".into())
}

#[cfg(not(windows))]
pub fn delete(_path: &str) -> Result<String, String> {
    Err("scheduled tasks are Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fake disk: two projects, and folders that exist without being projects.
    fn has(path: &Path) -> bool {
        let s = path.to_string_lossy().replace('\\', "/");
        [
            "C:/d/noleggio/package.json",
            "C:/d/noleggio",
            "C:/d/noleggio/run.ps1",
            "C:/d/hunter/package.json",
            "C:/d/hunter",
            "C:/d/hunter/scripts/giro.ts",
            "C:/Program Files/nodejs/node.exe",
            "C:/Windows/System32/conhost.exe",
            "C:/drivers/realtek/rtk.exe",
        ]
        .contains(&s.as_str())
    }

    fn task(path: &str, exe: &str, args: &str, workdir: Option<&str>) -> RawTask {
        RawTask {
            path: path.into(),
            name: path.rsplit('\\').next().unwrap().into(),
            enabled: true,
            actions: vec![RawAction { exe: exe.into(), args: args.into(), workdir: workdir.map(Into::into) }],
            ..Default::default()
        }
    }

    /// This machine's real tasks: `cargo test -- --ignored --nocapture print_the_tasks`.
    #[test]
    #[ignore]
    fn print_the_tasks() {
        for g in jobs().unwrap() {
            println!("{} ({})", g.name, g.root);
            for j in &g.jobs {
                println!("   {} [{}] {} | missing {:?} | last {:?} result 0x{:X} | next {:?} | {:?}", j.name, j.runtime, j.cmd, j.missing, j.last_run, j.last_result, j.next_run, j.triggers);
            }
        }
    }

    #[test]
    fn splits_windows_command_lines() {
        assert_eq!(split_args(r#"-NoProfile -File "C:\a b\run.ps1""#), vec!["-NoProfile", "-File", r"C:\a b\run.ps1"]);
        assert_eq!(split_args(r#"  x  "" y "#), vec!["x", "", "y"]);
    }

    #[test]
    fn expands_environment_variables() {
        let var = |n: &str| (n.eq_ignore_ascii_case("USERPROFILE")).then(|| r"C:\Users\me".to_string());
        assert_eq!(expand_env(r"%USERPROFILE%\x", &var), r"C:\Users\me\x");
        assert_eq!(expand_env("%NOPE%\\x", &var), "%NOPE%\\x");
        assert_eq!(expand_env("100% sure", &var), "100% sure");
    }

    #[test]
    fn finds_the_script() {
        let s = |c: &[&str]| script_of(&c.iter().map(|x| x.to_string()).collect::<Vec<_>>());
        assert_eq!(s(&["powershell.exe", "-NoProfile", "-File", r"C:\d\run.ps1"]).as_deref(), Some(r"C:\d\run.ps1"));
        assert_eq!(s(&["powershell.exe", "-Command", r"& 'C:\d\x.ps1' -Force"]).as_deref(), Some(r"C:\d\x.ps1"));
        assert_eq!(s(&["node.exe", "--import", "tsx", "scripts/giro.ts"]).as_deref(), Some("scripts/giro.ts"));
        assert_eq!(s(&[r"C:\d\job.bat"]).as_deref(), Some(r"C:\d\job.bat"));
        assert_eq!(s(&["rtk.exe", "-background"]), None);
    }

    #[test]
    fn groups_project_tasks_and_leaves_the_others_out() {
        let tasks = vec![
            task(r"\NoleggioAuto-Raccolta", "powershell.exe", r#"-NoProfile -WindowStyle Hidden -File "C:\d\noleggio\run.ps1""#, Some(r"C:\d\noleggio")),
            task(r"\pc-dreams cacciatore", r"C:\Windows\System32\conhost.exe", r#"--headless "C:\Program Files\nodejs\node.exe" --import tsx scripts/giro.ts"#, Some(r"C:\d\hunter")),
            task(r"\RtkAudUService64_BG", r#""C:\drivers\realtek\rtk.exe""#, "-background", None),
            task(r"\Microsoft\Windows\Defrag\ScheduledDefrag", "defrag.exe", "-c", Some(r"C:\d\noleggio")),
        ];
        let groups = group(&tasks, &has);
        let names: Vec<&str> = groups.iter().map(|g| g.name.as_str()).collect();
        assert_eq!(names, vec!["hunter", "noleggio"]);
        let hunter = &groups[0].jobs[0];
        // conhost --headless is only the wrapper: what runs is node.
        assert_eq!(hunter.runtime, "node");
        assert!(hunter.cmd.starts_with(r#""C:\Program Files\nodejs\node.exe" --import tsx"#), "{}", hunter.cmd);
        assert_eq!(hunter.script.as_deref().map(|s| s.replace('\\', "/")), Some("C:/d/hunter/scripts/giro.ts".into()));
        assert_eq!(hunter.missing, None);
        let noleggio = &groups[1].jobs[0];
        assert_eq!(noleggio.runtime, "powershell");
        assert_eq!(noleggio.folder, "\\");
    }

    #[test]
    fn keeps_a_task_whose_folder_is_gone() {
        let tasks = vec![
            task(r"\Quadratura", r"C:\Python312\pythonw.exe", r#""C:\d\money\scripts\bank.py" aggiorna"#, Some(r"C:\d\money")),
            task(r"\Dev Deck\old", "powershell.exe", r"-File C:\d\noleggio\gone.ps1", None),
        ];
        let groups = group(&tasks, &has);
        let money = groups.iter().find(|g| g.name == "money").expect("the missing folder is a group");
        assert_eq!(money.jobs[0].missing.as_deref(), Some(r"C:\d\money"));
        assert_eq!(money.jobs[0].runtime, "python");
        // The script is gone but the project is still there: it stays in the project.
        let noleggio = groups.iter().find(|g| g.name == "noleggio").unwrap();
        assert_eq!(noleggio.jobs[0].missing.as_deref(), Some(r"C:\d\noleggio\gone.ps1"));
        assert_eq!(noleggio.jobs[0].folder, "\\Dev Deck\\");
    }

    #[test]
    fn only_project_tasks_can_be_touched() {
        let groups = group(&[task(r"\Nightly", "node.exe", r"C:\d\hunter\x.js", None)], &has);
        assert!(allowed(&groups, r"\nightly").is_ok());
        assert!(allowed(&groups, r"\RtkAudUService64_BG").is_err());
    }

    #[test]
    fn converts_dates_durations_and_days() {
        // 46294.5 = 2026-09-29 12:00.
        assert_eq!(ole_date(46294.5).as_deref(), Some("2026-09-29T12:00:00"));
        assert_eq!(ole_date(46294.0 + 7.0 / 24.0 + 30.0 / 1440.0).as_deref(), Some("2026-09-29T07:30:00"));
        // The "never run" date.
        assert_eq!(ole_date(36494.0), None);
        assert_eq!(ole_date(0.0), None);
        assert_eq!(duration_minutes("PT48H"), Some(2880));
        assert_eq!(duration_minutes("P2D"), Some(2880));
        assert_eq!(duration_minutes("PT1H30M"), Some(90));
        assert_eq!(duration_minutes(""), None);
        assert_eq!(result_kind(0), "ok");
        assert_eq!(result_kind(267009), "running");
        assert_eq!(result_kind(2147942667), "folder-missing");
        assert_eq!(result_kind(1), "exit");
        assert_eq!(result_kind(0x8004_1318), "error");
        // Tuesday and Friday.
        assert_eq!(weekdays(36), vec![2, 5]);
    }
}

