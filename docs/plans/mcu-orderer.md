# MCU Orderer — Implementation Plan

## Context

A stylish, backend-free static site (HTML+CSS+vanilla JS) for building a personal ranking of all MCU theatrical films, published on GitHub Pages. Users rank via **Elo-style pairwise battles** (Tinder-like swipes, stop anytime) and/or **drag-and-drop** on a live list. The full state is compactly encoded in the URL fragment so rankings are shareable; opening someone else's link shows a read-only view with a "fork" option.

Decisions locked in during the interview:

- **Scope**: all 38 MCU theatrical films, Iron Man (2008) → Spider-Man: Brand New Day (July 31, 2026). Verified via web search (Brand New Day is officially "the 38th film in the MCU"; Avengers: Doomsday lands Dec 2026, not included).
- **Mechanic**: Elo battles with smart matchmaking, stoppable anytime; live ranking list visible on the same screen.
- **Source of truth**: the *ranked order* (not ratings). Drags rewrite the order; Elo ratings are ephemeral and re-seeded from the order after a manual drag.
- **Unseen movies**: "Haven't seen" button moves a film to an Unranked bin (excluded from battles, encoded in fragment, draggable back).
- **URL**: versioned fragment, live-updated via `history.replaceState`, plus Share/copy button; localStorage autosave as backup.
- **Shared links**: view-first read-only mode with "Start from this ranking" / "Keep mine" CTAs — never silently clobbers local progress.
- **Style**: dark cinematic (near-black bg, red/gold accents, glow, film-title-card feel).
- **Logos**: title-treatment images downloaded once from Wikipedia/Marvel wiki, committed under `assets/logos/`; styled-text fallback for any film without a usable logo.
- **Tests**: browser-level (no Node on the machine, keep it that way) — a `tests/` page with a tiny assertion harness, run via `agent-browser` CLI or manually.
- **Publish**: I create a public GitHub repo (`mcu-orderer`) via `gh`, push, and enable GitHub Pages.

## Repo layout

```
mcu-orderer/
├── index.html            # single page: battle card + live ranking list
├── css/style.css         # dark cinematic theme
├── js/
│   ├── movies.js         # catalog: [{id, slug, title, year, logo}]
│   ├── codec.js          # fragment encode/decode (pure, tested)
│   ├── elo.js            # rating seed/update math (pure, tested)
│   ├── matchmaking.js    # smart pair selection (pure, tested)
│   ├── state.js          # canonical state, localStorage, replaceState sync
│   ├── battle.js         # battle card UI, swipe gestures, keyboard
│   ├── list.js           # drag-and-drop ranking list (pointer events)
│   └── app.js            # bootstrap, shared-link view/fork flow, share button
├── assets/logos/         # committed logo images (webp/png/svg)
├── tools/fetch-logos.sh  # documented one-off downloader (curl)
├── tests/
│   ├── index.html        # browser test runner page
│   └── tests.js          # codec/elo/matchmaking unit + property tests
├── docs/plans/mcu-orderer.md   # this plan, saved into the repo
└── README.md
```

No build step, no dependencies, ES modules only.

## Data model

**Catalog** (`movies.js`): static array in release order; `id` = index (0–37), permanent forever — future films only ever append. Each entry: `id`, `slug` (e.g. `iron-man`), `title`, `year`, `logo` (path or `null` → text fallback). The 38 films:

Iron Man '08, The Incredible Hulk '08, Iron Man 2 '10, Thor '11, Captain America: The First Avenger '11, The Avengers '12, Iron Man 3 '13, Thor: The Dark World '13, The Winter Soldier '14, Guardians of the Galaxy '14, Age of Ultron '15, Ant-Man '15, Civil War '16, Doctor Strange '16, GotG Vol. 2 '17, Spider-Man: Homecoming '17, Thor: Ragnarok '17, Black Panther '18, Infinity War '18, Ant-Man and the Wasp '18, Captain Marvel '19, Endgame '19, Far From Home '19, Black Widow '21, Shang-Chi '21, Eternals '21, No Way Home '21, Multiverse of Madness '22, Love and Thunder '22, Wakanda Forever '22, Quantumania '23, GotG Vol. 3 '23, The Marvels '23, Deadpool & Wolverine '24, Brave New World '25, Thunderbolts* '25, The Fantastic Four: First Steps '25, Spider-Man: Brand New Day '26.

**Canonical state**:
```js
{ ranked: [id, ...],    // ordered, best first — THE ranking
  unranked: [id, ...] } // "haven't seen" bin
```
Initial state: `ranked` = release order, `unranked` = []. Ephemeral (never persisted): Elo `ratings: Map<id, number>` and per-movie battle counts.

## Fragment codec (`codec.js`)

- Alphabet: base64url (`A–Za–z0–9-_`), one char per movie id (supports 64 ids — years of headroom).
- Format: `#1` + `<ranked chars>` + (`.` + `<unranked chars>` if any). First char `1` is the version. Example: `#1GVSbA…M.c-` ≈ 40 chars total.
- Default pristine state → **no fragment** (clean URL until the first user action).
- Decode rules (forward compatibility): unknown version → treat as pristine; ids ≥ catalog size → ignored; catalog ids absent from the fragment (new films decoded by old links) → appended to `unranked` and badged "NEW" in the UI, preserving exactly what the sharer ranked.
- `encode(state) → string`, `decode(string) → state` — pure functions, round-trip tested.

## Elo engine (`elo.js`, `matchmaking.js`)

- **Seeding from order**: rating(rank i of n) = `1200 + (n − 1 − i) · SPREAD` with `SPREAD = 24`. Called on load and after every manual drag (order stays truth).
- **Update**: standard Elo, `K = 48`, expected score `1/(1+10^((Rb−Ra)/400))`. After each battle, `ranked` is re-derived by stable-sorting on rating (stability prevents unrelated rows jumping).
- **Matchmaking**: candidates = ranked movies only; score pairs by closeness of rating with a bonus for low battle-counts; exclude the immediately previous pair; pick randomly among the top few candidates so sessions don't feel deterministic. Pure function `pickPair(ratings, counts, lastPair, rng)` for testability (rng injected).
- No "done" condition — a swipe-count indicator plus visible list reshuffling shows convergence; user stops when it looks right.

## UI (`index.html`, `battle.js`, `list.js`, `app.js`, `style.css`)

Single page, mobile-first, dark cinematic (`#0b0b0f` bg, gold `#e8c15a` / red `#b6362f` accents, subtle glow, condensed display type for numerals).

- **Battle area** (top): two logo cards, "Which is better?"; vote by tapping a card, swiping it toward center/left-right (pointer events with drag+tilt animation), or ←/→ keys. Each card has a small "Haven't seen it" action → moves to Unranked with a toast + undo. Swipe counter shown.
- **Ranking list** (below): numbered rows (rank, logo thumb/title, year); rows animate position changes after each battle (FLIP). Drag to reorder via pointer events (works on touch — native HTML5 DnD does not). Unranked section at the bottom; dragging a row into/out of it works both ways.
- **Share button**: copies current URL, toast confirmation. Fragment stays live via `replaceState` after every mutation.
- **Shared-link flow** (`app.js`): on load, if fragment present and ≠ own localStorage state → read-only banner mode ("Someone's ranking") with two CTAs: *Start from this ranking* (adopt as local state) / *Make my own* (keep/init local state, drop fragment). If fragment matches local state (user reopening their own link) → normal editing mode.
- Reset button (confirm dialog) → pristine state.

## Logos (`tools/fetch-logos.sh`, `assets/logos/`)

One-off `curl`-based script (committed for provenance) that downloads each film's title-treatment image from Wikipedia/Wikimedia/Marvel-wiki URLs listed inline; I'll resolve the 38 URLs during implementation via web search/fetch, eyeball each result, and downscale to a sane width. Any film without a clean transparent logo gets `logo: null` → styled typographic title card (Marvel-ish condensed caps, gold on dark) so the UI never breaks. README credits sources.

## Tests (`tests/`) — no Node

- `tests/index.html` + `tests.js`: ~50-line assertion harness (`test(name, fn)`, `assertEq`), imports `codec.js`, `elo.js`, `matchmaking.js` as ES modules, renders green/red results and sets `window.__results = {passed, failed, failures}` + `document.title = "PASS"/"FAIL"`.
- Coverage: codec round-trips (full, partial, empty-unranked, pristine), decode of unknown ids/versions, "new movie appended to unranked" migration, seeded-PRNG property test (random states round-trip), Elo update math, seeding monotonicity, matchmaking never repeats last pair / never picks unranked / handles 2-movie edge.
- Run: `agent-browser` CLI opens the local server URL and reads `window.__results` / title. Also runnable by just opening the page.

## Implementation steps

1. Scaffold repo: `git init`, README, layout above.
2. `movies.js` catalog (38 films, verified list).
3. `codec.js` + `elo.js` + `matchmaking.js` (pure modules) and `tests/` — get tests green first via `agent-browser`.
4. `state.js` (state transitions, localStorage, replaceState) and static page markup + dark theme CSS.
5. `battle.js` swipe cards + `list.js` pointer-based drag-and-drop + FLIP animations.
6. `app.js` shared-link view/fork flow, share button, reset.
7. Logos: resolve URLs, `tools/fetch-logos.sh`, download, wire into catalog, text fallback for gaps.
8. Save this plan into the repo as `docs/plans/mcu-orderer.md`.
9. Publish: `gh repo create mcu-orderer --public`, push `main`, enable Pages (deploy from branch, `/` root) via `gh api`; verify live URL.
   Per global rules: no AI attribution in commits.

## Verification

- Unit: serve with `uv run python -m http.server`, drive `tests/index.html` with `agent-browser`, assert title `PASS`.
- E2E with `agent-browser` against the local server: swipe several battles and confirm list reorder + fragment appears; drag a row and confirm order + fragment change; "haven't seen" → Unranked; copy URL, open in fresh profile/incognito-like context → read-only banner → "Start from this" adopts state; malformed/truncated fragments don't crash (fall back to pristine); reload restores from localStorage.
- Codec sanity: hand-check one encoded URL decodes to the same visible order.
- After publish: open the GitHub Pages URL, repeat a quick smoke pass (battle, drag, share round-trip).
