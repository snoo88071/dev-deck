# Dev Deck: the design system

What the panel is for: a developer, between two tasks, glances at what the computer holds
(Claude Code sessions, dev processes, scheduled tasks), decides, and acts (close, reopen,
stop). Then goes back to work. Everything below serves that glance.

The tokens live in `ui/src/palette.ts` (antd theme + `--dd-*` CSS variables) and the
shared rules in `ui/src/global.css`. This file says why; the code says what.

## Principles

1. **A color is a state, never decoration.** Green: free or alive. Amber: still, nobody
   working. Red: danger, or something failing now. What you can press is ink. If a color
   is on screen, it means something.
2. **Proportion before words.** Weight is drawn (the memory strip, the meter under each
   figure, the CPU over 24 h), not explained. No copy that judges or teaches.
3. **Feedback where the action was.** What closing gave back counts up in the closed row;
   "Reopened" shows on the button that reopened.
4. **A number beside a page is inventory; a red badge is something waiting for you.**
   Never a badge for history or totals.
5. **One way to read a row.** Identity first (project, then branch/kind in small grey),
   then the state, then what is left, then the person's own words. Figures right-aligned,
   tabular, all the same size.
6. **Disclose on demand.** A History row is one line, read like an inbox: project, what
   it was about, when. A click opens the rest in place (what is left, the last prompt,
   branch, origin, dates, Describe); nothing is repeated between the two.
7. **Quiet until needed.** Secondary actions (Describe, open folder, restart) appear when
   the row is under the pointer or holds the focus; always on touch. Destructive icons are
   ink at rest and red only under the pointer. The one action a row exists for (Reopen,
   Close, a verdict) is always visible and always in the same column.

## Color

| Token | Light | Dark | Use |
|---|---|---|---|
| paper | `#ffffff` | `#121419` | the page; tables and lists sit on it, no cards |
| side | `#f4f5f7` | `#0d0f13` | the sidebar |
| line | `#e9ebef` | `#23272f` | hairlines between rows |
| ink | `#161a21` | `#e8eaee` | text, primary buttons, focus ring |
| ink2 / ink3 | `#454c59` / `#5b6371` | `#b7bdc8` / `#9aa2b0` | secondary / tertiary text (both pass 4.5:1) |
| green | `#13773a` (fill `#2e9a5c`) | `#4cc584` | free RAM, open, running, switch on |
| amber | `#965507` (fill `#c97a1a`) | `#f0a64a` | idle session, forgotten process, tight RAM |
| red | `#c22f33` | `#f2777b` | danger on hover/confirm, failing tasks, short RAM, attention badges |

Free RAM is green above 20% of the total, amber under it, red under 8% (`freeTone`).

## Type

IBM Plex Sans for the interface, JetBrains Mono for what is code (paths, branches,
commands, ports): the pair chosen in the September redesign. Both are bundled
(@fontsource), never loaded from the network.

- Page title 20/600, tracking -0.015em. Summary 13, a phrase ("4 open, 2 active in the
  last hour"), not dot-joined fragments.
- Row title 14/600. Body 14/400. Meta 12-12.5. Day headings 13/600, sentence case.
- Numbers: `.dd-num` (tabular figures). Memory figures 14/600 everywhere.
- No all-caps labels.

## Layout

- Content column at most 1440 px, centered (History: 1080, it is read like prose);
  56 px gutters from 1280 px up, 36 below, 16 narrow.
- Lists (Sessions, History) and tables (Processes, Scheduled, Cleanup) sit directly on
  the paper, rows separated by hairlines, hover a shade of the paper. Row content is
  inset 10 px and the list pulled out by the same amount, so text aligns with the title.
- Descriptions are capped at 820 px wide: past that a line is too long to read.
- Paths under the user's profile read from `~`.
- Below 600 px secondary columns fold into the row; below 900 px the sidebar folds.

## Motion

Only in answer to an action: a closed row's meter drains and its gain counts up, then
the row folds; the free figure counts up. A busy idle session's last CPU point pulses.
Reduced motion: antd's `motion` token off, our classes stop (see the antd field note on
`prefers-reduced-motion`: never a blanket `animation: none`).

## Checks

`npm run ui-check` (behavior, no horizontal scroll at 1280/760/420 in both themes) and
`npm run contrast` (every text against its real background, both themes) must pass.
