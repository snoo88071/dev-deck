# Dev Deck

A tray panel for Windows that shows the development processes running on your machine,
grouped by project. See them, stop them, restart them, open their port or folder.

Task Manager shows twelve `node.exe`. Dev Deck shows `acme-shop/backend · npm → tsx → node · :8792`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/processes-dark.png">
  <img alt="Processes, grouped by project, with a project's process tree open" src="docs/processes.png">
</picture>

## Features

- **One row per project**, found by walking up from each process's working directory to the
  nearest `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml` or `.git`.
- **Every dev runtime**: node, bun, deno, python, uv, cargo, java, dotnet, go, ruby, php, with
  the tool (npm, tsx, vite, uvicorn…), memory, CPU, uptime and listening ports.
- **Process trees stay together**: `npm start` → `tsx` → `node`, even across the `cmd.exe`
  npm spawns on Windows.
- **Stop** a process tree or a whole project, **restart** a tree with the same command, folder
  and environment, **open** `localhost:PORT`, the folder, or VS Code.
- **Claude Code sessions**: what's open, in which folder, the last prompt, and (opt-in) a
  one-line description of what each one is working on.
- **Cleanup in shadow mode**: proposes what to close (orphan MCP servers, duplicates, idle
  servers) with evidence, and never closes anything by itself.
- **An MCP server** so Claude Code can see and manage the same processes.
- **Light and dark**, following Windows or pinned from the sidebar, in five languages.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/sessions-dark.png">
  <img alt="Open Claude Code sessions with their descriptions" src="docs/sessions.png">
</picture>

More detail: [how it works](docs/how-it-works.md).

## Requirements

- Windows 10 or 11 (with WebView2, preinstalled on Windows 11)
- To build: [Rust](https://rustup.rs) (stable) and Node.js 24+
- Optional: the [Claude Code](https://claude.com/claude-code) CLI, for sessions and the MCP server

## Install

Download the installer from the Releases page (it isn't code-signed, so SmartScreen may warn
on first run), or build it:

```
npm install
npm run build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`; the plain exe is
`src-tauri/target/release/dev-deck.exe`. Closing the window hides it to the tray; quit from
the tray menu.

## Use it from Claude Code

```
cd src-tauri && cargo build --release --bin devdeck
cd ../mcp && npm install
claude mcp add -s user dev-deck -- node <path-to-repo>/mcp/src/server.ts
```

Then, in a session: "clean up my dev processes". Tools: `dev_processes`, `dev_sessions`,
`dev_cleanup`, `dev_verdict`, `dev_kill`, `dev_restart`.

## Session descriptions (opt-in)

Off by default. When on, Dev Deck sends the tail of each session's transcript to
`claude -p --model haiku` (about 1¢ per description) and caches the answer. Turn them on
with the switch in the Sessions tab, or with `DEVDECK_DESCRIBE=1`.

## Languages

English and Italian, plus Spanish, French and Brazilian Portuguese as **drafts that need a
native speaker's review** (`ui/src/locales/`). The panel follows the Windows language; the
menu at the bottom of the sidebar changes it. Corrections are very welcome.

## Known limitations

- **Windows only for now.** The code compiles elsewhere, but restart and folder opening are
  only tested on Windows.
- Processes started as administrator have no readable working directory: they land in
  "unknown folder" and can't be restarted.
- Restart always opens a new `cmd` window.
- It doesn't start with Windows on its own yet.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). License: [MIT](LICENSE).
