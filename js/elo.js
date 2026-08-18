// Elo machinery. The ranked *order* is the canonical state; ratings are an
// ephemeral working set seeded from that order, and the order is re-derived
// from ratings after every battle.

export const BASE_RATING = 1200;
export const SEED_SPREAD = 24;
export const K = 48;

// ranked: array of ids, best first → Map(id → rating), evenly spread.
export function seedRatings(ranked) {
  const n = ranked.length;
  return new Map(ranked.map((id, i) => [id, BASE_RATING + (n - 1 - i) * SEED_SPREAD]));
}

export function expectedScore(ra, rb) {
  return 1 / (1 + 10 ** ((rb - ra) / 400));
}

// Returns [newWinnerRating, newLoserRating].
export function updateRatings(winner, loser) {
  const e = expectedScore(winner, loser);
  return [winner + K * (1 - e), loser - K * (1 - e)];
}

// Re-derive the ranked order from ratings. The sort is stable (Array.sort is
// stable per spec), so equal-rated movies keep their relative order and rows
// unrelated to the battle never jump.
export function orderByRating(ranked, ratings) {
  return [...ranked].sort((a, b) => ratings.get(b) - ratings.get(a));
}
