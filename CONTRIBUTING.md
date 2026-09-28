# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome; for anything larger,
open an issue first so we can agree on the shape before you write it.

## Setup

You need Windows 10/11, [Rust](https://rustup.rs) (stable) and Node.js 24+.

```
npm install
npm run dev           # the panel, recompiling Rust on every change
```

The panel also runs in a plain browser on demo data ("demo" in the header), which is the
fastest way to work on the UI:

```
npm run ui:dev        # http://localhost:1420, with hot reload
```

For the MCP server:

```
cd src-tauri && cargo build --bin devdeck
cd ../mcp && npm install
```

## Tests

Run what touches your change before opening a PR:

```
cd src-tauri && cargo test                  # process grouping, sessions, actions, on fake processes
node --test ui/cleanup.test.js ui/locales.test.js   # cleanup rules; every language has every string
npm run ui:build                            # types and bundle (needed by the next two)
npm run ui-check                            # the demo panel in Playwright: pages, keyboard, filter, actions, themes
npm run contrast                            # WCAG AA contrast of every text, light and dark
cd mcp && npm run check && npm test         # MCP types, shadow file, and the server as Claude Code starts it
```

`cargo test -- --ignored --nocapture` prints the real groups on your machine, handy when a
process lands in the wrong project.

## Guidelines

- **Logic on fake data.** Grouping, session matching and cleanup rules are pure functions over
  plain structs; add a test with fake processes rather than depending on what's running.
- **`ui/cleanup.js` is shared** by the panel and the MCP server: keep it dependency-free and in
  its UMD shape.
- **The panel** is React + TypeScript with [Ant Design](https://ant.design) components, built by Vite.
  Colors are antd tokens in `ui/src/palette.ts`; run `npm run contrast` after touching them.
- **Strings** live in `ui/src/locales/<lang>.json`: add a key to `en.json` and to every other
  language (the test fails otherwise). Native-speaker fixes to es, fr and pt are very welcome.
- **The MCP server** has no build step: TypeScript run directly by Node.
- **Safety first on actions.** Anything that kills or restarts goes through Rust, which
  re-checks every pid. Cleanup never closes on its own.
- **Short comments that explain why**, not what. Match the style of the file you're in.

## Pull requests

- One topic per PR, with a short description of what changes and how you tested it.
- Screenshots for visible UI changes (`npm run ui-check` saves some in `tools/shots/`;
  `npm run screenshots` refreshes the ones in `docs/`).
- CI runs the tests above on Windows; keep it green.
