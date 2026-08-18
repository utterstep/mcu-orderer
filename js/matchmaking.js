// Smart pair selection: prefer matchups between movies with similar current
// ratings (high information) and few past battles, with a bit of injected
// randomness so sessions don't feel deterministic.

const WINDOW = 5; // how many rating-neighbors each movie is considered against
const COUNT_PENALTY = 18; // rating-points-equivalent cost per past battle
const TOP_POOL = 5; // pick uniformly among this many best candidates

// ids: rankable movie ids; ratings: Map(id → rating); counts: Map(id → battles);
// lastPair: [idA, idB] or null; rng: () => [0,1). Returns [idA, idB] or null.
export function pickPair(ids, ratings, counts, lastPair, rng) {
  if (ids.length < 2) return null;
  const sorted = [...ids].sort((a, b) => ratings.get(b) - ratings.get(a));
  const last = lastPair ? new Set(lastPair) : null;

  const candidates = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < Math.min(i + 1 + WINDOW, sorted.length); j++) {
      const [a, b] = [sorted[i], sorted[j]];
      if (last && last.has(a) && last.has(b)) continue;
      const score =
        Math.abs(ratings.get(a) - ratings.get(b)) +
        COUNT_PENALTY * ((counts.get(a) ?? 0) + (counts.get(b) ?? 0));
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
