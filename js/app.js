import { MOVIES, CATALOG_SIZE } from './movies.js';
import { MAX_PLACE } from './elo.js';
import {
  Store, pristineState, statesEqual, loadLocal, readFragment, saveStats, clearHistory,
} from './state.js';
import { initDebug } from './debug.js';
import { Battle } from './battle.js';
import { RankingList } from './list.js';

const $ = sel => document.querySelector(sel);

// ---------- toast ----------

let toastTimer = null;
function showToast(msg, { actionLabel, onAction, duration = 4500 } = {}) {
  const toast = $('#toast');
  const action = $('#toast-action');
  $('#toast-msg').textContent = msg;
  action.hidden = !actionLabel;
  if (actionLabel) {
    action.textContent = actionLabel;
    action.onclick = () => { hideToast(); onAction(); };
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}
function hideToast() {
  $('#toast').hidden = true;
  clearTimeout(toastTimer);
}

// ---------- boot ----------

const fragment = readFragment();
const local = loadLocal();
const ownLink = fragment && local && statesEqual(fragment, local);
const viewing = Boolean(fragment && !ownLink);

if (viewing) {
  // Someone else's ranking: read-only until adopted. Nothing is persisted, so
  // the visitor's own in-progress ranking is never clobbered.
  document.body.classList.add('viewing');
  $('#fork-banner').hidden = false;
  $('#share').hidden = true;
  $('#reset').hidden = true;

  const store = new Store({ ranked: fragment.ranked, unranked: fragment.unranked });
  const list = new RankingList({
    store,
    rankedEl: $('#ranked-list'),
    unrankedEl: $('#unranked-list'),
    unrankedHead: $('#unranked-head'),
    newIds: fragment.added,
  });
  list.render();

  const forkOwn = $('#fork-own');
  forkOwn.textContent = local
    ? forkOwn.dataset.labelKeep
    : forkOwn.dataset.labelFresh;

  $('#fork-adopt').addEventListener('click', () => {
    store.persist(); // write this state to localStorage + keep the fragment
    // The adopted order was deliberate: mark every movie as already placed so
    // subsequent battles refine it gently instead of teleporting entries.
    const ids = [...Array(CATALOG_SIZE).keys()];
    saveStats({
      counts: new Map(ids.map(id => [id, MAX_PLACE])),
      losses: new Map(ids.map(id => [id, 1])),
      streaks: new Map(),
    });
    clearHistory();
    location.reload(); // reboots into normal editing mode (fragment == local)
  });
  forkOwn.addEventListener('click', () => {
    history.replaceState(null, '', location.pathname + location.search);
    location.reload(); // reboots into the visitor's own state (or pristine)
  });
} else {
  const store = new Store(
    local ? { ranked: local.ranked, unranked: local.unranked } : pristineState(),
  );
  store.persist(); // sync fragment with restored state right away

  const list = new RankingList({
    store,
    rankedEl: $('#ranked-list'),
    unrankedEl: $('#unranked-list'),
    unrankedHead: $('#unranked-head'),
    newIds: local?.added,
  });
  list.render();

  const battle = new Battle({
    store,
    section: $('#battle'),
    onUnseen: id => {
      const from = store.markUnseen(id);
      showToast(`“${MOVIES[id].title}” moved to Haven't seen`, {
        actionLabel: 'Undo',
        onAction: () => store.restoreRanked(id, from, { cause: 'undo' }),
      });
    },
  });
  battle.next();
  battle.updateCount();

  store.subscribe((_state, meta) => {
    list.render({ animate: true });
    if (meta.cause === 'drag' && meta.id !== undefined) battle.establish(meta.id);
    if (meta.cause !== 'battle') battle.reseed({ clearCounts: meta.cause === 'reset' });
  });

  $('#share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('Link copied — send it to a friend!');
    } catch {
      showToast('Copying failed — grab the URL from the address bar.');
    }
  });

  $('#reset').addEventListener('click', () => {
    if (confirm('Reset your ranking back to release order?')) store.reset();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') battle.vote(0);
    else if (e.key === 'ArrowRight') battle.vote(1);
  });

  if (new URLSearchParams(location.search).has('debug')) initDebug({ store, battle });
}
