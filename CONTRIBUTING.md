# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome; for anything larger,
open an issue first so we can agree on the shape before you write it.

## Setup

You need Windows 10/11, [Rust](https://rustup.rs) (stable) and Node.js 24+.

```
npm install
npm run dev           # the panel, recompiling Rust on every change
```

The panel also runs in a plain browser: open `ui/index.html` and it uses demo data
("demo" in the header). That's the fastest way to work on the UI.

For the MCP server:

```
cd src-tauri && cargo build --bin devdeck
cd ../mcp && npm install
```

## Tests

Run what touches your change before opening a PR:

```
cd src-tauri && cargo test                  # process grouping, sessions, actions, on fake processes
node --test ui/cleanup.test.js              # cleanup rules
npm run contrast                            # text/background contrast from the CSS (WCAG AA)
npm run ui-check                            # the demo panel in Playwright: tabs, keyboard, filter, actions
cd mcp && npm run check && npm test         # MCP types, shadow file, and the server as Claude Code starts it
```

`cargo test -- --ignored --nocapture` prints the real groups on your machine, handy when a
process lands in the wrong project.

## Guidelines

- **Logic on fake data.** Grouping, session matching and cleanup rules are pure functions over
  plain structs; add a test with fake processes rather than depending on what's running.
- **`ui/cleanup.js` is shared** by the panel and the MCP server: keep it dependency-free and in
  its UMD shape.
- **No build step** for `ui/` and `mcp/`: plain JS in the browser, TypeScript run directly by Node.
- **Safety first on actions.** Anything that kills or restarts goes through Rust, which
  re-checks every pid. Cleanup never closes on its own.
- **Short comments that explain why**, not what. Match the style of the file you're in.
- UI colors are variables in `ui/style.css`; run `npm run contrast` after touching them.

## Pull requests

- One topic per PR, with a short description of what changes and how you tested it.
- Screenshots for visible UI changes (`npm run ui-check` saves some in `tools/shots/`).
- CI runs the tests above on Windows; keep it green.
