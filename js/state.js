import { MOVIES, CATALOG_SIZE } from './movies.js';
import { encode, decode } from './codec.js';

const STORAGE_KEY = 'mcu-orderer:v1';
const STATS_KEY = 'mcu-orderer:stats:v1';

export function pristineState() {
  return { ranked: MOVIES.map(m => m.id), unranked: [] };
}

export function isPristine({ ranked, unranked }) {
  return unranked.length === 0 && ranked.every((id, i) => id === i);
}

export function statesEqual(a, b) {
  return a.ranked.length === b.ranked.length &&
    a.unranked.length === b.unranked.length &&
    a.ranked.every((id, i) => id === b.ranked[i]) &&
    a.unranked.every((id, i) => id === b.unranked[i]);
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const decoded = decode(raw, CATALOG_SIZE);
    return decoded && { ranked: decoded.ranked, unranked: decoded.unranked, added: decoded.added };
  } catch {
    return null;
  }
}

// Per-movie battle statistics (battle count, loss count, current win streak),
// persisted so a reload doesn't make every movie provisional again and
// re-trigger placement jumps on an already-settled ranking. Not part of the
// shareable fragment.
export function loadStats() {
  const counts = new Map();
  const losses = new Map();
  const streaks = new Map();
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY));
    for (let id = 0; id < CATALOG_SIZE; id++) {
      counts.set(id, Number(raw?.c?.[id]) || 0);
      losses.set(id, Number(raw?.l?.[id]) || 0);
      streaks.set(id, Number(raw?.s?.[id]) || 0);
    }
  } catch { /* fall through to zeroed maps */ }
  return { counts, losses, streaks };
}

export function saveStats({ counts, losses, streaks }) {
  const arr = map => Array.from({ length: CATALOG_SIZE }, (_, id) => map.get(id) ?? 0);
  try {
    localStorage.setItem(STATS_KEY,
      JSON.stringify({ c: arr(counts), l: arr(losses), s: arr(streaks) }));
  } catch { /* private mode etc. */ }
}

// Full vote history for debugging (see ?debug): one entry per battle, capped.
// {t: epoch ms, a, b: the pair as displayed, w: winner id, p: placer id|null}
const HISTORY_KEY = 'mcu-orderer:history:v1';
const HISTORY_CAP = 1000;

export function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

export function appendHistory(entry) {
  const history = loadHistory();
  history.push(entry);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-HISTORY_CAP)));
  } catch { /* private mode etc. */ }
}

export function clearHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}

export function readFragment() {
  const frag = location.hash.slice(1);
  return frag ? decode(frag, CATALOG_SIZE) : null;
}

// Central store: canonical {ranked, unranked} + change notification.
// Persists to localStorage and mirrors into the URL fragment on every change.
export class Store {
  constructor(state) {
    this.state = state;
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
  }

  set(next, meta = {}) {
    this.state = next;
    this.persist();
    for (const fn of this.listeners) fn(this.state, meta);
  }

  persist() {
    const encoded = encode(this.state);
    try {
      localStorage.setItem(STORAGE_KEY, encoded);
    } catch { /* private mode etc. — URL still carries the state */ }
    const url = isPristine(this.state)
      ? location.pathname + location.search
      : '#' + encoded;
    history.replaceState(null, '', url);
  }

  // Move a movie to absolute position `index` within ranked/unranked.
  move(id, toUnranked, index, meta = {}) {
    const ranked = this.state.ranked.filter(x => x !== id);
    const unranked = this.state.unranked.filter(x => x !== id);
    (toUnranked ? unranked : ranked).splice(index, 0, id);
    this.set({ ranked, unranked }, meta);
  }

  markUnseen(id) {
    const from = this.state.ranked.indexOf(id);
    this.move(id, true, this.state.unranked.length, { cause: 'unseen', id, from });
    return from; // previous rank, for undo
  }

  restoreRanked(id, index, meta = {}) {
    this.move(id, false, index, meta);
  }

  reset() {
    this.set(pristineState(), { cause: 'reset' });
  }
}
