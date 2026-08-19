// Elo machinery. The ranked *order* is the canonical state; ratings are an
// ephemeral working set seeded from that order, and the order is re-derived
// from ratings after every battle.

export const BASE_RATING = 1200;
export const SEED_SPREAD = 24;
export const K = 48;

// Placement phase: a movie's first battles are binary-search probes rather
// than Elo nudges, so anything can escape its seeded position in a handful of
// votes (Elo alone caps movement at ~K per win, which imprisons bottom-seeded
// movies under an ~888-point ladder). A movie stays provisional until its
// first loss, but always gets at least MIN_PLACE and at most MAX_PLACE
// placement battles.
export const MIN_PLACE = 2;
export const MAX_PLACE = 5;

// An established movie that wins this many battles in a row earns placement
// again (an upward probe): one mistaken vote during placement can no longer
// exile a movie permanently, since sustained winning restores its mobility.
export const REPLACE_STREAK = 3;

export function isProvisional(count, lossCount, winStreak = 0) {
  return count < MIN_PLACE
    || (lossCount === 0 && count < MAX_PLACE)
    || winStreak >= REPLACE_STREAK;
}

// Positional jump for a provisional movie: land just beside the opponent.
// A win never moves it down, a loss never moves it up.
export function placementRating(own, opponent, won) {
  return won
    ? Math.max(own, opponent + SEED_SPREAD / 2)
    : Math.min(own, opponent - SEED_SPREAD / 2);
}

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
