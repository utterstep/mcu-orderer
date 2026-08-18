// URL-fragment codec for a ranking state.
//
// Format (without the leading '#'):
//   "1" + <one base64url char per ranked movie id, best first>
//       + optionally "." + <one char per unranked ("haven't seen") movie id>
//
// The leading "1" is the format version. One char encodes ids 0..63, which
// leaves headroom for years of MCU output. Movies missing from a fragment
// (films released after the link was shared) are appended to `unranked` and
// reported in `added` so the UI can badge them as new.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CHAR_TO_ID = new Map([...ALPHABET].map((c, i) => [c, i]));

export const VERSION = '1';

export function encode({ ranked, unranked }) {
  const chars = ids => ids.map(id => ALPHABET[id]).join('');
  return VERSION + chars(ranked) + (unranked.length ? '.' + chars(unranked) : '');
}

// Returns { ranked, unranked, added } or null if the fragment is not ours /
// is malformed. `catalogSize` is the number of movies this build knows about.
export function decode(fragment, catalogSize) {
  if (typeof fragment !== 'string' || fragment[0] !== VERSION) return null;
  const body = fragment.slice(1);
  const dot = body.indexOf('.');
  const parts = dot === -1 ? [body, ''] : [body.slice(0, dot), body.slice(dot + 1)];
  if (parts[1].includes('.')) return null;

  const seen = new Set();
  const parse = str => {
    const ids = [];
    for (const ch of str) {
      const id = CHAR_TO_ID.get(ch);
      if (id === undefined) return null;
      // Ids from a newer catalog than ours, and duplicates, are dropped.
      if (id >= catalogSize || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  };

  const ranked = parse(parts[0]);
  const unranked = parse(parts[1]);
  if (ranked === null || unranked === null) return null;

  const added = [];
  for (let id = 0; id < catalogSize; id++) {
    if (!seen.has(id)) {
      unranked.push(id);
      added.push(id);
    }
  }
  return { ranked, unranked, added };
}
