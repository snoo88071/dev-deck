---
name: dev-deck-tidy
description: Check for dev servers and background processes this Claude Code session left running (vite, npm run dev, uvicorn, watchers, test servers), and offer to stop them, using the Dev Deck MCP tools. Use it before wrapping up a task in which you started a server or a long-running command; when a command fails because a port is already in use (EADDRINUSE, "Port 1420 is already in use", "address already in use"); or when the user asks what is still running, whether you left something on, or to clean up dev processes.
---

# Tidy up what this session left running

Servers started during a task often outlive it: a `vite` from a quick check, an
`npm run dev` whose terminal was closed, a test server spawned through a shell
that `kill()` didn't reach. They hold ports and memory until someone notices.
Dev Deck sees them, grouped by project, and knows which Claude Code session
started each one.

## When

- **Wrapping up** a task in which you started servers, watchers or background
  commands. Once per task, at the end, not after every step.
- **A port is busy** (EADDRINUSE, "already in use"): find out who holds it
  before picking another port or telling the user to reboot.
- **The user asks** what is running, whether you left something on, or to
  clean up.

Skip it when the task started nothing long-running.

## How

1. `dev_processes` (scope `session`) lists this session's processes and those of
   its projects. For a busy port, use scope `all` and look for the port.
2. `dev_cleanup` turns them into proposals with evidence: `session` (started by
   this session), `duplicate`, `orphan-mcp`, `idle`. It closes nothing: it runs
   in shadow mode and records each proposal for the user's verdict.
3. Show the user what you found, briefly: what it is, which project, which port,
   how long it has been running, and why it looks leftover. Then ask what to do
   with each one.
4. On the user's answer, record it with `dev_verdict` (`close`, `keep`, or
   `wrong`, with their reason as `note` when they give one). Stop only what
   they said to close, with `dev_kill`, passing the proposal id and a one-line
   reason.

A server the task still needs (the one the user is looking at in the browser)
is not leftover: say it is still running and move on.

## Never

- Stop anything without the user's yes, even your own servers. The verdicts are
  what measures when Claude could be trusted to do it alone.
- Record a verdict the user didn't give.
- Touch Claude Code itself, or MCP servers of other open sessions (`dev_kill`
  refuses them unless `force`, which is only for an explicit request).
- Retry a failed kill in a loop: report the error.

If the Dev Deck tools are missing or fail with "devdeck not found", tell the
user the Dev Deck app (which ships `devdeck-cli.exe`) needs to be installed, and
stop there.
