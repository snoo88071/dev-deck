# How Dev Deck works

## Processes

- **Project of a process**: the nearest folder, walking up from its working directory, that
  contains `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml` or `.git`.
  On Windows `C:\x\` and `c:\x` are the same folder.
- **Trees**: each root is followed by its descendants, so `npm start` → `tsx` → `node` stay
  together even with the invisible `cmd.exe` npm puts in between.
- **Stop** kills the whole tree (`taskkill /T`). It always asks first, and warns when Claude
  Code is among the processes.
- **Restart** works on the root of a tree: it kills it and relaunches the same command, in the
  same folder, with **the same environment** (a `PORT=8793` survives), in a new `cmd` window
  where you see the output and can stop it with Ctrl+C.
- **Claude Code's MCP servers stay aside.** On a machine with a few sessions open they are most
  of the `node.exe` processes. Inside a project they sit in a collapsed section and "stop
  project" leaves them alone (stopping them would break a live session); groups made only of
  them go to the bottom, under "Launched by Claude Code".
- **Dev Deck never shows or touches itself**: its own process tree is excluded, and Rust
  re-checks every pid before acting (still alive, still a dev process).
- The list refreshes every 3 seconds, only while the window is visible.

## Claude Code sessions

The Sessions tab (and the `dev_sessions` MCP tool) lists open Claude Code sessions: from a
terminal, from VS Code, and background jobs. The daemon and `claude -p` runs are left out.

- **Which transcript belongs to a process**: the id in its command line (`--session-id`, or
  `--resume` without `--fork-session`). Without one, the transcript in its folder under
  `~/.claude/projects/` created after the process started and written most recently. If there
  are several candidates, or it was created more than 15 minutes after the start, the panel
  marks it "uncertain transcript".
- **Descriptions (opt-in)**: `claude -p --model haiku --no-session-persistence`, fed with the
  tail of the transcript (the last text messages, shortened), started from
  `~/.dev-deck/claude-p` so it doesn't create a transcript of its own. About 7 seconds and a
  fraction of a cent each, written in the app's language (the Windows one, or English).
  Cached in `~/.dev-deck/sessions.json`, tied to the transcript's size and last modification.
- **Refresh**: while descriptions are on and the app is running, every 5 minutes it redoes (one
  at a time) the ones whose transcript changed and whose description is older than 30 minutes.
  "Describe" redoes one right away.
- **Read only**: sessions can't be closed from Dev Deck and never enter cleanup.

From a terminal: `devdeck sessions` and `devdeck describe <id or pid> [--force]`.

## Scheduled tasks

The Scheduled page (and the `dev_jobs` MCP tool) lists the Windows Task Scheduler's tasks that
run something in a project. Read with the Task Scheduler's API, not `schtasks`, whose output is
in the Windows language.

- **Which tasks**: those whose working folder, script (`-File x.ps1`, `x.py`, `scripts/x.ts`...)
  or program sits in a project, found as for processes. `conhost --headless node x.js` counts
  as `node x.js`. A task whose folder or script no longer exists is kept too, grouped under
  that folder: it fails at every run, and that is the case worth seeing. Windows's own tasks
  (`\Microsoft\`) never enter.
- **What it shows**: what it runs, when (in words), the last run with its outcome (a Windows
  code such as `0x8007010B` becomes "the folder doesn't exist"), the next run.
- **Actions**: run now, disable, enable, open the script in VS Code, delete. Run, disable and
  delete ask first. Rust checks again that the task is a project task before touching it.
  **Delete** first saves the task's definition to `~/.dev-deck/deleted-tasks/` (UTF-16 XML, as
  Windows writes it): `schtasks /create /tn "<name>" /xml "<file>"` brings it back.
- **In Processes**: a process a task started (itself, or its `powershell` → `cmd` → `node`)
  carries the task's name, and a project with tasks shows "N scheduled", which opens this
  page on that project. The running tasks are read every 5 seconds in the background.
- **From Claude Code**: `dev_jobs` is read only. The `dev-deck-jobs` skill has Claude check it
  before creating a task, and register new ones under `\Dev Deck\` with the project as
  working folder, so they show up here.

The list refreshes every 10 seconds while the window is visible.

## Cleanup, in shadow mode

The Cleanup tab (and `dev_cleanup` for Claude Code) proposes processes to close. Each proposal
has a category and its evidence:

| category | when | evidence |
|---|---|---|
| **Orphan MCP** | an MCP server with no live Claude Code session above it, parent gone | dead parent, no session |
| **Duplicate** | same command in the same folder as another running process | the twin pid; the one with a port (or the oldest) stays |
| **Started by this session** | a background server started by this Claude Code session (not an MCP) | age, ports held |
| **Idle** | running for more than 12 hours, zero CPU, no port in its tree | age, CPU, ports |
| **Task pointing to a missing path** | a scheduled task whose folder or script no longer exists | the missing path, last and next run |
| **Failing task** | a scheduled task whose last run failed | when, and the outcome |

For a scheduled task, "close" disables it (it isn't deleted). Disabled tasks are never proposed.

Never proposed: Claude Code itself, MCP servers of a live session, Dev Deck.

**Shadow mode means it closes nothing on its own.** Proposals go to `~/.dev-deck/shadow.jsonl`
and you judge them: **close**, **right, keep it**, **wrong**, in the panel or by telling
Claude. A proposal you kept or marked wrong doesn't come back for the same process. The rules
live in `ui/cleanup.js`, shared by the panel and the MCP server.

How right the proposals are, per category:

```
cd mcp && npm run shadow
```

It prints proposals, verdicts, right diagnoses and how many you actually closed. The rule for
letting Claude close a category on its own is written but off: at least 20 verdicts, at least
95% "close", no "wrong" among the last 10. When a category passes it, turning it on is your call.

## Configuration

Everything has a default derived from your home folder; these environment variables override it.

| variable | what |
|---|---|
| `DEVDECK_DESCRIBE` | `1` / `0`: force session descriptions on or off (wins over the panel switch) |
| `DEVDECK_SHADOW` | path of the shadow file (default `~/.dev-deck/shadow.jsonl`) |
| `DEVDECK_SESSIONS` | path of the descriptions cache (default `~/.dev-deck/sessions.json`) |
| `DEVDECK_DELETED_TASKS` | where deleted scheduled tasks leave their copy (default `~/.dev-deck/deleted-tasks/`) |
| `DEVDECK_BIN` | path of the `devdeck` binary, for the MCP server |
| `CLAUDE_BIN` | the Claude Code CLI used for descriptions (default `claude`) |
| `DEVDECK_LANG` | `en`, `it`, `es`, `fr` or `pt`: the app's language instead of the Windows one |

## Layout

- `src-tauri/src/procs.rs`: reads processes (`sysinfo`) and ports (`netstat2`) and groups them.
  The logic runs on fake processes in the tests.
- `src-tauri/src/actions.rs`: stop, restart, open, and the shadow file.
- `src-tauri/src/sessions.rs`, `describe.rs`: Claude Code sessions and their descriptions.
- `src-tauri/src/tasks.rs`: the scheduled tasks (the Task Scheduler's COM API), grouped by
  project; the logic runs on fake tasks in the tests.
- `src-tauri/src/lib.rs`: tray, window and the commands the panel calls.
- `src-tauri/src/bin/devdeck.rs`: the same data and actions as JSON, for the MCP server.
- `ui/`: the panel, React + TypeScript with [Ant Design](https://ant.design), built by Vite
  (`ui/src/`; the theme in `palette.ts`, the strings in `locales/`). Outside Tauri it runs
  on demo data.
- `mcp/`: the MCP server in TypeScript, run directly by Node 24 (no build).
