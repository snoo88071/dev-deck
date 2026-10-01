//! CPU history: once a minute, while Dev Deck runs (in the tray too), how much CPU
//! each session and each project's processes used in that minute. Kept 24 hours in
//! `~/.dev-deck/cpu.jsonl`, so closing and reopening Dev Deck doesn't lose it.
//!
//! A sample is the average over the minute (sysinfo measures CPU between two reads),
//! as a share of the whole machine: 100 = every core busy.

use crate::procs::{self, Group, RawProc};
use crate::sessions;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const KEEP_SECS: u64 = 24 * 3600;
/// The 24 hours in half-hour slices: enough for a line 120 px wide.
pub const BUCKETS: usize = 48;
const EVERY: Duration = Duration::from_secs(60);
/// Samples are appended; once an hour the file is rewritten without those older than 24 hours.
const REWRITE_EVERY: u32 = 60;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    /// Unix seconds.
    pub t: u64,
    /// By session key (`pid@start`): Claude Code with the development processes under it.
    #[serde(default)]
    pub s: BTreeMap<String, f32>,
    /// By group: its folder, or its name when it has none.
    #[serde(default)]
    pub g: BTreeMap<String, f32>,
}

pub type Shared = Arc<Mutex<Vec<Sample>>>;

/// The key a group goes by in the history (the panel builds the same one).
pub fn group_key(g: &Group) -> String {
    g.root.clone().unwrap_or_else(|| g.name.clone())
}

fn round(x: f32) -> f32 {
    (x * 100.0).round() / 100.0
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// One sample from a read of the processes. `cpus` = the machine's logical cores:
/// sysinfo gives 100 per busy core.
pub fn sample(t: u64, all: &[RawProc], groups: &[Group], cpus: f32) -> Sample {
    let share = |cpu: f32| round(cpu / cpus.max(1.0));
    let s = sessions::roots(all)
        .into_iter()
        .map(|(p, _)| {
            let cpu = p.cpu + sessions::descendants(all, p.pid).iter().map(|k| k.cpu).sum::<f32>();
            (sessions::key_of(p), share(cpu))
        })
        .collect();
    let g = groups.iter().map(|g| (group_key(g), share(g.cpu))).collect();
    Sample { t, s, g }
}

/// The last 24 hours up to `now` in `BUCKETS` slices, oldest first, for each key: the
/// average of its samples in the slice, None where there are none (Dev Deck was off,
/// or the process didn't exist yet).
pub fn buckets(samples: &[Sample], now: u64) -> HashMap<String, Vec<Option<f32>>> {
    let from = now.saturating_sub(KEEP_SECS);
    let width = KEEP_SECS / BUCKETS as u64;
    let mut sums: HashMap<String, Vec<(f32, u32)>> = HashMap::new();
    for x in samples.iter().filter(|x| x.t > from && x.t <= now) {
        let i = (((x.t - from - 1) / width) as usize).min(BUCKETS - 1);
        for (k, v) in x.s.iter().chain(x.g.iter()) {
            let slot = &mut sums.entry(k.clone()).or_insert_with(|| vec![(0.0, 0); BUCKETS])[i];
            slot.0 += v;
            slot.1 += 1;
        }
    }
    sums.into_iter()
        .map(|(k, v)| (k, v.into_iter().map(|(sum, n)| (n > 0).then(|| round(sum / n as f32))).collect()))
        .collect()
}

pub fn path() -> PathBuf {
    if let Ok(p) = std::env::var("DEVDECK_CPU") {
        return p.into();
    }
    crate::describe::dir().join("cpu.jsonl")
}

/// The file's samples from the last 24 hours; lines that don't parse are skipped.
pub fn load(path: &Path, now: u64) -> Vec<Sample> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    let mut out: Vec<Sample> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    out.retain(|x| x.t + KEEP_SECS > now);
    out
}

fn append(path: &Path, x: &Sample) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(f, "{}", serde_json::to_string(x).unwrap_or_default())
}

/// Writes the samples to a temporary file and puts it in place: a crash midway leaves the old file.
pub fn rewrite(path: &Path, samples: &[Sample]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension("jsonl.tmp");
    let mut text = String::new();
    for x in samples {
        text.push_str(&serde_json::to_string(x).unwrap_or_default());
        text.push('\n');
    }
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

/// Loads the file and starts sampling, once a minute, on a thread of its own.
pub fn start() -> Shared {
    let path = path();
    let loaded = load(&path, now());
    let _ = rewrite(&path, &loaded);
    let shared: Shared = Arc::new(Mutex::new(loaded));
    let out = shared.clone();
    std::thread::spawn(move || {
        let mut sys = sysinfo::System::new();
        let cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1) as f32;
        // The first read only sets where CPU is measured from.
        procs::snapshot(&mut sys);
        let mut n = 0u32;
        loop {
            std::thread::sleep(EVERY);
            let all = procs::snapshot(&mut sys);
            let own = procs::own_tree(&all);
            let groups = procs::group(&all, &|p| p.exists(), &own);
            let t = now();
            let x = sample(t, &all, &groups, cpus);
            let mut v = shared.lock().unwrap_or_else(|e| e.into_inner());
            v.push(x.clone());
            v.retain(|x| x.t + KEEP_SECS > t);
            n += 1;
            let _ = if n % REWRITE_EVERY == 0 { rewrite(&path, &v) } else { append(&path, &x) };
        }
    });
    out
}

/// The history for the panel, in slices.
pub fn read(shared: &Shared) -> HashMap<String, Vec<Option<f32>>> {
    let v = shared.lock().unwrap_or_else(|e| e.into_inner());
    buckets(&v, now())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(pid: u32, parent: Option<u32>, name: &str, cmd: &[&str], cpu: f32) -> RawProc {
        RawProc {
            pid,
            parent,
            name: name.into(),
            cmd: cmd.iter().map(|s| s.to_string()).collect(),
            cwd: None,
            memory: 100,
            cpu,
            run_time: 10,
            start: 1000 + pid as u64,
            ports: vec![],
        }
    }

    fn at(t: u64, key: &str, v: f32) -> Sample {
        Sample { t, s: BTreeMap::from([(key.to_string(), v)]), g: BTreeMap::new() }
    }

    #[test]
    fn a_session_counts_claude_and_the_processes_under_it_as_a_share_of_the_machine() {
        let all = vec![
            raw(10, None, "claude.exe", &["claude"], 20.0),
            raw(11, Some(10), "node.exe", &["node", "mcp.js"], 30.0),
            raw(12, Some(11), "node.exe", &["node", "vite.js"], 50.0),
            raw(13, None, "node.exe", &["node", "other.js"], 99.0),
        ];
        let x = sample(5, &all, &[], 4.0);
        assert_eq!(x.s, BTreeMap::from([("10@1010".to_string(), 25.0)]));
    }

    #[test]
    fn slices_average_their_samples_and_leave_gaps_empty() {
        let now = 100_000;
        let width = KEEP_SECS / BUCKETS as u64;
        let samples = vec![
            at(now - KEEP_SECS - 5, "a", 50.0), // older than 24 hours: out
            at(now - 1, "a", 2.0),
            at(now, "a", 4.0),
            at(now - width - 1, "a", 8.0),
        ];
        let b = buckets(&samples, now);
        let a = &b["a"];
        assert_eq!(a.len(), BUCKETS);
        assert_eq!(a[BUCKETS - 1], Some(3.0));
        assert_eq!(a[BUCKETS - 2], Some(8.0));
        assert!(a[..BUCKETS - 2].iter().all(|x| x.is_none()));
    }

    #[test]
    fn the_file_keeps_only_the_last_24_hours() {
        let dir = std::env::temp_dir().join(format!("devdeck-history-{}", std::process::id()));
        let path = dir.join("cpu.jsonl");
        let now = 200_000;
        rewrite(&path, &[at(now - KEEP_SECS - 1, "old", 1.0), at(now - 60, "new", 2.0)]).unwrap();
        append(&path, &at(now, "new", 3.0)).unwrap();
        std::fs::write(&path, std::fs::read_to_string(&path).unwrap() + "not json\n").unwrap();
        let v = load(&path, now);
        assert_eq!(v.iter().map(|x| x.t).collect::<Vec<_>>(), vec![now - 60, now]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
