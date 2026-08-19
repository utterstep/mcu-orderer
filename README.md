# MCU Orderer

Build your personal ranking of all 38 MCU theatrical films — from *Iron Man* (2008)
to *Spider-Man: Brand New Day* (2026) — and share it as a single URL.

**Live: https://utterstep.github.io/mcu-orderer/**

## How it works

- **Battle mode** — two films, tap/swipe the better one (or use ←/→). Each
  movie's first battles are *placement* rounds: binary-search probes (median
  first, then halfway up while it keeps winning) where the movie jumps straight
  to its opponent's neighborhood — so a beloved film escapes the bottom of the
  list in a few votes instead of being trapped by Elo's small step size.
  After its first loss, gentle Elo refinement with smart matchmaking takes
  over (close ratings, low battle counts, biased toward the top of the list —
  the part you actually care about). An established movie that wins three in a
  row earns fresh upward probes, so one mistaken vote can never exile a film
  permanently. The counter shows a confidence estimate ("roughly ±N slots",
  fitted from simulations); stop whenever the order looks right — there's no
  fixed number of rounds.
- **Drag-and-drop** — the ranked list is always directly editable; drag rows to
  fix what the battles got wrong. The order is the source of truth: after a
  manual drag, Elo ratings are re-seeded from it.
- **Haven't seen it** — banishes a film to an unranked bin (and out of battles).
  Drag it back any time.
- **Sharing** — the whole state is encoded in the URL fragment (one base64url
  character per film + a version prefix, ~40 chars) and updated on every
  change. Opening someone else's link shows their ranking read-only, with a
  choice to fork it or keep yours. Films released after a link was shared show
  up as unranked and badged NEW — old links never break.

No backend, no build step, no dependencies, no tracking. Plain HTML+CSS+JS,
hosted on GitHub Pages; state lives in the URL and localStorage.

**Debugging**: add `?debug` to the URL for a live panel with every movie's
rating, W–L record, streak, and placement phase, plus the full vote history
(persisted in localStorage, capped at 1000 votes) and a "Copy debug JSON"
export.

## Development

Serve the repo root with any static server, e.g.:

```sh
uv run python -m http.server 8642
```

Unit tests (fragment codec, Elo math, matchmaking) run in the browser — open
`/tests/` and check the page title says `PASS`. Headless, with
[agent-browser](https://github.com/vercel-labs/agent-browser):

```sh
agent-browser open http://localhost:8642/tests/ && agent-browser eval 'document.title'
```

## Logos

Film title logos are © Marvel Studios / The Walt Disney Company, used here for
identification only. They were fetched from the
[MCU wiki](https://marvelcinematicuniverse.fandom.com) and
[Wikimedia Commons](https://commons.wikimedia.org) by `tools/fetch-logos.sh`,
which records the exact source file for each logo.
