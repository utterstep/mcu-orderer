// Pair selection.
//
// While any movie is provisional (see elo.js), matchmaking runs its placement:
// the least-battled provisional movie probes binary-search style — first
// against the median, then halfway toward the top while it keeps winning, or
// halfway toward the bottom once it has lost. An established movie on a win
// streak re-enters placement with upward probes, so nothing stays exiled.
//
// Afterwards, refinement pairs movies with similar current ratings (high
// information) and few past battles, biased toward the top of the ranking —
// that's the part of the list people actually care about — with a bit of
// injected randomness so sessions don't feel deterministic.

import { isProvisional, REPLACE_STREAK } from './elo.js';

const WINDOW = 5; // how many rating-neighbors each movie is considered against
const COUNT_PENALTY = 18; // rating-points-equivalent cost per past battle
const RANK_BIAS = 3; // rating-points-equivalent cost per rank away from the top
const TOP_POOL = 5; // pick uniformly among this many best candidates
const JITTER = 2; // ± ranks of noise on a placement probe target

const samePair = (a, b) => b && new Set(b).has(a[0]) && new Set(b).has(a[1]);

// ids: rankable movie ids; ratings: Map(id → rating); stats: {counts, losses,
// streaks} Maps; lastPair: [idA, idB] or null; rng: () => [0,1).
// Returns [idA, idB] or null.
export function pickPair(ids, ratings, stats, lastPair, rng) {
  if (ids.length < 2) return null;
  const { counts, losses, streaks } = stats;
  const order = [...ids].sort((a, b) => ratings.get(b) - ratings.get(a));

  const provisionals = ids.filter(id =>
    isProvisional(counts.get(id) ?? 0, losses.get(id) ?? 0, streaks.get(id) ?? 0));
  if (provisionals.length) {
    const minCount = Math.min(...provisionals.map(id => counts.get(id) ?? 0));
    const pool = provisionals.filter(id => (counts.get(id) ?? 0) === minCount);
    const placer = pool[Math.floor(rng() * pool.length)];

    const n = order.length;
    const r = order.indexOf(placer);
    const probeUp = (losses.get(placer) ?? 0) === 0 || (streaks.get(placer) ?? 0) >= REPLACE_STREAK;
    let target;
    if ((counts.get(placer) ?? 0) === 0) target = Math.floor(n / 2);
    else if (probeUp) target = Math.floor(r / 2);
    else target = Math.floor((r + n) / 2);
    target += Math.floor(rng() * (2 * JITTER + 1)) - JITTER;
    target = Math.max(0, Math.min(n - 1, target));

    // Nearest rank to the target that isn't the placer or the previous pair.
    for (const off of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5]) {
      const opp = order[target + off];
      if (opp === undefined || opp === placer) continue;
      if (samePair([placer, opp], lastPair) && n > 2) continue;
      return rng() < 0.5 ? [placer, opp] : [opp, placer];
    }
    // Degenerate field (e.g. two movies that just battled): allow the repeat.
    const opp = order.find(id => id !== placer);
    return rng() < 0.5 ? [placer, opp] : [opp, placer];
  }

  const candidates = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < Math.min(i + 1 + WINDOW, order.length); j++) {
      const [a, b] = [order[i], order[j]];
      if (samePair([a, b], lastPair)) continue;
      const score =
        Math.abs(ratings.get(a) - ratings.get(b)) +
        COUNT_PENALTY * ((counts.get(a) ?? 0) + (counts.get(b) ?? 0)) +
        RANK_BIAS * (i + j) / 2;
      candidates.push({ pair: [a, b], score });
    }
  }
  if (!candidates.length) return lastPair ? [...lastPair] : null;

  candidates.sort((x, y) => x.score - y.score);
  const pool = candidates.slice(0, TOP_POOL);
  const { pair } = pool[Math.floor(rng() * pool.length)];
  // Randomize sides so the better-rated movie isn't always on the left.
  return rng() < 0.5 ? pair : [pair[1], pair[0]];
}

// Which side of a pair (if any) takes the placement jump instead of an Elo
// update: the provisional one; if both are provisional, the lower-count one,
// ties broken toward the lower-rated.
export function pickPlacer(pair, ratings, stats) {
  const { counts, losses, streaks } = stats;
  const [a, b] = pair;
  const prov = id =>
    isProvisional(counts.get(id) ?? 0, losses.get(id) ?? 0, streaks.get(id) ?? 0);
  const [pa, pb] = [prov(a), prov(b)];
  if (!pa && !pb) return null;
  if (pa !== pb) return pa ? a : b;
  const key = id => [counts.get(id) ?? 0, ratings.get(id)];
  const [ka, kb] = [key(a), key(b)];
  return ka[0] < kb[0] || (ka[0] === kb[0] && ka[1] <= kb[1]) ? a : b;
}
