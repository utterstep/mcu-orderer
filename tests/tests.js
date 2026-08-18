import { encode, decode } from '../js/codec.js';
import { seedRatings, expectedScore, updateRatings, orderByRating, BASE_RATING, SEED_SPREAD, K } from '../js/elo.js';
import { pickPair } from '../js/matchmaking.js';
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

// --- matchmaking ----------------------------------------------------------

test('matchmaking: needs two movies', () => {
  const r = new Map([[0, 1200]]);
  assertEq(pickPair([0], r, new Map(), null, prng(1)), null);
  assertEq(pickPair([], r, new Map(), null, prng(1)), null);
});

test('matchmaking: two movies works even when they were the last pair', () => {
  const r = new Map([[0, 1200], [1, 1224]]);
  const p = pickPair([0, 1], r, new Map(), [0, 1], prng(1));
  assertEq([...p].sort(), [0, 1]);
});

test('matchmaking: never repeats last pair when alternatives exist', () => {
  const ids = allIds;
  const ratings = seedRatings(ids);
  const counts = new Map();
  let last = null;
  const rng = prng(42);
  for (let i = 0; i < 300; i++) {
    const p = pickPair(ids, ratings, counts, last, rng);
    assert(p !== null);
    assert(p[0] !== p[1], 'distinct movies');
    if (last) {
      assert(!(new Set(last).has(p[0]) && new Set(last).has(p[1])), `repeat at ${i}`);
    }
    for (const id of p) counts.set(id, (counts.get(id) ?? 0) + 1);
    last = p;
  }
});

test('matchmaking: only offered ids are picked', () => {
  const ids = [4, 9, 17];
  const ratings = new Map([[4, 1200], [9, 1210], [17, 1500]]);
  const rng = prng(3);
  for (let i = 0; i < 50; i++) {
    const p = pickPair(ids, ratings, new Map(), null, rng);
    assert(ids.includes(p[0]) && ids.includes(p[1]));
  }
});

test('matchmaking: battle counts spread coverage across the field', () => {
  const ids = allIds;
  const ratings = seedRatings(ids);
  const counts = new Map();
  let last = null;
  const rng = prng(11);
  for (let i = 0; i < 200; i++) {
    const p = pickPair(ids, ratings, counts, last, rng);
    for (const id of p) counts.set(id, (counts.get(id) ?? 0) + 1);
    last = p;
  }
  const touched = ids.filter(id => (counts.get(id) ?? 0) > 0).length;
  assert(touched >= ids.length * 0.9, `only ${touched}/${ids.length} movies ever battled`);
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
