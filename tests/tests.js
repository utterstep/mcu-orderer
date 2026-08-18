import { encode, decode } from '../js/codec.js';
import {
  seedRatings, expectedScore, updateRatings, orderByRating,
  isProvisional, placementRating,
  BASE_RATING, SEED_SPREAD, K, MIN_PLACE, MAX_PLACE,
} from '../js/elo.js';
import { pickPair, pickPlacer } from '../js/matchmaking.js';
import { loadStats, saveStats } from '../js/state.js';
import { MOVIES, CATALOG_SIZE } from '../js/movies.js';

// --- tiny harness ---------------------------------------------------------

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e) });
  }
}
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
function assertEq(actual, expected, msg = '') {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) throw new Error(`${msg} expected ${e}, got ${a}`);
}

// Deterministic PRNG (mulberry32) for property tests.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- catalog --------------------------------------------------------------

test('catalog has 38 films, Iron Man first, Brand New Day last', () => {
  assertEq(CATALOG_SIZE, 38);
  assertEq(MOVIES[0].title, 'Iron Man');
  assertEq(MOVIES[37].title, 'Spider-Man: Brand New Day');
  assert(MOVIES.every((m, i) => m.id === i), 'ids must equal indices');
  assertEq(new Set(MOVIES.map(m => m.slug)).size, 38, 'slugs unique');
});

// --- codec ----------------------------------------------------------------

const allIds = [...Array(CATALOG_SIZE).keys()];

test('codec: pristine round-trip', () => {
  const s = { ranked: allIds, unranked: [] };
  const d = decode(encode(s), CATALOG_SIZE);
  assertEq(d.ranked, s.ranked);
  assertEq(d.unranked, []);
  assertEq(d.added, []);
});

test('codec: ranked + unranked round-trip', () => {
  const s = { ranked: [5, 0, 21, 37], unranked: [1, 25] };
  const d = decode(encode(s), CATALOG_SIZE);
  assertEq(d.ranked, s.ranked);
  // absent ids get appended to unranked as "added"
  const absent = allIds.filter(id => !s.ranked.includes(id) && !s.unranked.includes(id));
  assertEq(d.unranked, [...s.unranked, ...absent]);
  assertEq(d.added, absent);
});

test('codec: property — random full states round-trip (200 seeds)', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = prng(seed);
    const order = shuffled(allIds, rng);
    const cut = Math.floor(rng() * (CATALOG_SIZE + 1));
    const s = { ranked: order.slice(0, cut), unranked: order.slice(cut) };
    const d = decode(encode(s), CATALOG_SIZE);
    assertEq(d.ranked, s.ranked, `seed ${seed} ranked:`);
    assertEq(d.unranked, s.unranked, `seed ${seed} unranked:`);
    assertEq(d.added, [], `seed ${seed} added:`);
  }
});

test('codec: fragment is compact', () => {
  const s = { ranked: allIds.slice(0, 30), unranked: allIds.slice(30) };
  assert(encode(s).length <= 45, `too long: ${encode(s).length}`);
});

test('codec: old link gains new films as added-unranked', () => {
  // encode with a smaller catalog of 36, decode against 38
  const oldIds = [...Array(36).keys()];
  const d = decode(encode({ ranked: oldIds, unranked: [] }), CATALOG_SIZE);
  assertEq(d.ranked, oldIds);
  assertEq(d.unranked, [36, 37]);
  assertEq(d.added, [36, 37]);
});

test('codec: ids beyond our catalog are ignored (link from the future)', () => {
  const d = decode(encode({ ranked: [39, 0, 1], unranked: [38] }), CATALOG_SIZE);
  assertEq(d.ranked, [0, 1]);
  assert(!d.unranked.includes(38) && !d.unranked.includes(39));
});

test('codec: garbage is rejected', () => {
  assertEq(decode('', CATALOG_SIZE), null);
  assertEq(decode('2ABC', CATALOG_SIZE), null, 'unknown version:');
  assertEq(decode('1A#C', CATALOG_SIZE), null, 'bad char:');
  assertEq(decode('1A.B.C', CATALOG_SIZE), null, 'two dots:');
  assertEq(decode(null, CATALOG_SIZE), null);
});

test('codec: duplicate ids keep first occurrence', () => {
  const d = decode('1AAB.B', CATALOG_SIZE);
  assertEq(d.ranked, [0, 1]);
  assertEq(d.unranked.includes(1), false);
});

// --- elo ------------------------------------------------------------------

test('elo: seeding is monotonic in rank order', () => {
  const ranked = shuffled(allIds, prng(7));
  const r = seedRatings(ranked);
  for (let i = 1; i < ranked.length; i++) {
    assert(r.get(ranked[i - 1]) === r.get(ranked[i]) + SEED_SPREAD, 'even spread');
  }
  assertEq(r.get(ranked[ranked.length - 1]), BASE_RATING);
});

test('elo: expected score is symmetric and sane', () => {
  assertEq(expectedScore(1200, 1200), 0.5);
  const e = expectedScore(1400, 1200);
  assert(e > 0.5 && e < 1);
  assert(Math.abs(e + expectedScore(1200, 1400) - 1) < 1e-12);
});

test('elo: update conserves total rating and rewards upsets more', () => {
  const [w1, l1] = updateRatings(1200, 1400); // upset
  const [w2, l2] = updateRatings(1400, 1200); // expected result
  assert(Math.abs(w1 + l1 - 2600) < 1e-9, 'conserved');
  assert(w1 - 1200 > w2 - 1400, 'upset moves more');
  assert(w2 - 1400 > 0 && w2 - 1400 < K);
});

test('elo: orderByRating sorts desc and is stable for ties', () => {
  const ratings = new Map([[3, 100], [1, 200], [2, 100], [0, 300]]);
  assertEq(orderByRating([3, 1, 2, 0], ratings), [0, 1, 3, 2]);
});

test('elo: a battle win reorders adjacent movies', () => {
  const ranked = [0, 1, 2, 3];
  const ratings = seedRatings(ranked);
  const [w, l] = updateRatings(ratings.get(2), ratings.get(1));
  ratings.set(2, w).set(1, l);
  assertEq(orderByRating(ranked, ratings), [0, 2, 1, 3]);
});

// --- placement ------------------------------------------------------------

test('placement: provisional until first loss, min 2, max 5 battles', () => {
  assert(isProvisional(0, 0) && isProvisional(1, 0) && isProvisional(1, 1));
  assert(isProvisional(4, 0), 'undefeated stays provisional');
  assert(!isProvisional(MAX_PLACE, 0), 'placement capped');
  assert(!isProvisional(MIN_PLACE, 1), 'a loss after min battles establishes');
});

test('placement: rating jumps beside the opponent, never the wrong way', () => {
  assertEq(placementRating(1200, 1600, true), 1600 + SEED_SPREAD / 2);
  assertEq(placementRating(1200, 1600, false), 1200, 'loss never lifts');
  assertEq(placementRating(1600, 1200, false), 1200 - SEED_SPREAD / 2);
  assertEq(placementRating(1600, 1200, true), 1600, 'win never drops');
});

test('placement: a fresh movie probes the middle of the field', () => {
  const ids = allIds;
  const ratings = seedRatings(ids);
  const counts = new Map(ids.map(id => [id, MAX_PLACE]));
  const losses = new Map(ids.map(id => [id, 1]));
  counts.set(37, 0); losses.set(37, 0); // one unplaced movie at the bottom
  const rng = prng(5);
  for (let i = 0; i < 25; i++) {
    const p = pickPair(ids, ratings, counts, losses, null, rng);
    assert(p.includes(37), 'the provisional movie battles first');
    const opp = p[0] === 37 ? p[1] : p[0];
    const rank = orderByRating(ids, ratings).indexOf(opp);
    assert(Math.abs(rank - 19) <= 3, `probe near median, got rank ${rank + 1}`);
  }
});

test('placement: pickPlacer chooses the provisional / lower-count side', () => {
  const ratings = new Map([[0, 1500], [1, 1300]]);
  const est = new Map([[0, MAX_PLACE], [1, MAX_PLACE]]);
  const lost = new Map([[0, 1], [1, 1]]);
  assertEq(pickPlacer([0, 1], ratings, est, lost), null, 'both established:');
  assertEq(pickPlacer([0, 1], ratings, new Map([[0, MAX_PLACE], [1, 0]]), lost), 1);
  assertEq(pickPlacer([0, 1], ratings, new Map([[0, 1], [1, 0]]), new Map()), 1, 'lower count:');
  assertEq(pickPlacer([0, 1], ratings, new Map(), new Map()), 1, 'tie → lower rating:');
});

// --- matchmaking ----------------------------------------------------------

const established = ids => ({
  counts: new Map(ids.map(id => [id, MAX_PLACE])),
  losses: new Map(ids.map(id => [id, 1])),
});

test('matchmaking: needs two movies', () => {
  const r = new Map([[0, 1200]]);
  assertEq(pickPair([0], r, new Map(), new Map(), null, prng(1)), null);
  assertEq(pickPair([], r, new Map(), new Map(), null, prng(1)), null);
});

test('matchmaking: two movies works even when they were the last pair', () => {
  const r = new Map([[0, 1200], [1, 1224]]);
  for (const { counts, losses } of [established([0, 1]), { counts: new Map(), losses: new Map() }]) {
    const p = pickPair([0, 1], r, counts, losses, [0, 1], prng(1));
    assertEq([...p].sort(), [0, 1]);
  }
});

test('matchmaking: never repeats last pair when alternatives exist', () => {
  const ids = allIds;
  const ratings = seedRatings(ids);
  const counts = new Map();
  const losses = new Map();
  let last = null;
  const rng = prng(42);
  for (let i = 0; i < 300; i++) {
    const p = pickPair(ids, ratings, counts, losses, last, rng);
    assert(p !== null);
    assert(p[0] !== p[1], 'distinct movies');
    if (last) {
      assert(!(new Set(last).has(p[0]) && new Set(last).has(p[1])), `repeat at ${i}`);
    }
    for (const id of p) counts.set(id, (counts.get(id) ?? 0) + 1);
    losses.set(p[0], (losses.get(p[0]) ?? 0) + 1); // arbitrary loser
    last = p;
  }
});

test('matchmaking: only offered ids are picked', () => {
  const ids = [4, 9, 17];
  const ratings = new Map([[4, 1200], [9, 1210], [17, 1500]]);
  const rng = prng(3);
  for (const { counts, losses } of [established(ids), { counts: new Map(), losses: new Map() }]) {
    for (let i = 0; i < 50; i++) {
      const p = pickPair(ids, ratings, counts, losses, null, rng);
      assert(ids.includes(p[0]) && ids.includes(p[1]));
    }
  }
});

test('matchmaking: battle counts spread coverage across the field', () => {
  const ids = allIds;
  const ratings = seedRatings(ids);
  const { counts, losses } = established(ids);
  let last = null;
  const rng = prng(11);
  const seen = new Map();
  for (let i = 0; i < 200; i++) {
    const p = pickPair(ids, ratings, counts, losses, last, rng);
    for (const id of p) {
      counts.set(id, counts.get(id) + 1);
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    last = p;
  }
  const touched = ids.filter(id => (seen.get(id) ?? 0) > 0).length;
  assert(touched >= ids.length * 0.9, `only ${touched}/${ids.length} movies ever battled`);
});

// --- battle-flow simulation (the real modules end to end) ------------------

function simulateSession({ prefPos, battles, rng }) {
  const ids = allIds;
  const ratings = seedRatings(ids); // release-order seed, as in the app
  const counts = new Map();
  const losses = new Map();
  let pair = null;
  for (let t = 0; t < battles; t++) {
    pair = pickPair(ids, ratings, counts, losses, pair, rng);
    const [a, b] = pair;
    const winner = prefPos.get(a) < prefPos.get(b) ? a : b;
    const loser = winner === a ? b : a;
    const placer = pickPlacer(pair, ratings, counts, losses);
    const [nw, nl] = updateRatings(ratings.get(winner), ratings.get(loser));
    if (placer === null) {
      ratings.set(winner, nw).set(loser, nl);
    } else {
      const opp = pair[0] === placer ? pair[1] : pair[0];
      const oppBefore = ratings.get(opp);
      ratings.set(opp, opp === winner ? nw : nl);
      ratings.set(placer, placementRating(ratings.get(placer), oppBefore, placer === winner));
    }
    for (const id of pair) counts.set(id, (counts.get(id) ?? 0) + 1);
    losses.set(loser, (losses.get(loser) ?? 0) + 1);
  }
  return orderByRating(ids, ratings);
}

test('simulation: a beloved bottom-seeded movie escapes to the top 10 in 150 battles', () => {
  // The user's true #1 is the newest movie (seeded at rank 38); everything
  // else follows release order. This is the exact scenario that motivated the
  // placement mechanic — plain Elo left it around rank 30 here.
  const prefPos = new Map(allIds.map(id => [id, id === 37 ? -1 : id]));
  for (const seed of [1, 2, 3]) {
    const order = simulateSession({ prefPos, battles: 150, rng: prng(seed) });
    const rank = order.indexOf(37) + 1;
    assert(rank <= 10, `seed ${seed}: still at rank ${rank}`);
  }
});

test('simulation: 300 battles reach ≥85% pairwise agreement on a random preference', () => {
  for (const seed of [7, 8]) {
    const rng = prng(seed);
    const truth = shuffled(allIds, rng);
    const prefPos = new Map(truth.map((id, i) => [id, i]));
    const order = simulateSession({ prefPos, battles: 300, rng });
    const pos = new Map(order.map((id, i) => [id, i]));
    let good = 0;
    let total = 0;
    for (const x of allIds) {
      for (const y of allIds) {
        if (x >= y) continue;
        total++;
        const trueOrder = prefPos.get(x) < prefPos.get(y);
        if (trueOrder === (pos.get(x) < pos.get(y))) good++;
      }
    }
    assert(good / total >= 0.85, `seed ${seed}: only ${(good / total * 100).toFixed(1)}%`);
  }
});

// --- stats persistence ----------------------------------------------------

test('stats: save/load round-trip with defaults for missing movies', () => {
  const counts = new Map([[0, 3], [37, 1]]);
  const losses = new Map([[0, 1]]);
  saveStats(counts, losses);
  const loaded = loadStats();
  assertEq(loaded.counts.get(0), 3);
  assertEq(loaded.counts.get(37), 1);
  assertEq(loaded.counts.get(5), 0, 'missing defaults to 0:');
  assertEq(loaded.losses.get(0), 1);
  assertEq(loaded.losses.get(37), 0);
  localStorage.removeItem('mcu-orderer:stats:v1');
});

// --- report ---------------------------------------------------------------

const failed = results.filter(r => !r.ok);
document.getElementById('results').innerHTML = results
  .map(r => `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ' — ' + r.error}</div>`)
  .join('');
document.getElementById('summary').textContent =
  `${results.length - failed.length}/${results.length} passed`;
document.title = failed.length ? 'FAIL' : 'PASS';
window.__results = {
  passed: results.length - failed.length,
  failed: failed.length,
  failures: failed.map(f => `${f.name}: ${f.error}`),
};
