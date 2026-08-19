// Diagnostics panel, enabled by adding ?debug to the URL. Shows the live
// Elo/placement internals plus the persisted vote history, and can export
// everything as JSON for filing an issue or poking at in a notebook.
import { MOVIES } from './movies.js';
import { isProvisional } from './elo.js';
import { loadHistory } from './state.js';

const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function initDebug({ store, battle }) {
  const section = document.createElement('section');
  section.id = 'debug';
  document.querySelector('main').after(section);

  const render = () => {
    const { counts, losses, streaks } = battle.stats;
    const history = loadHistory();
    const title = id => MOVIES[id].title;
    const stat = (map, id) => map.get(id) ?? 0;

    const row = (id, rank) => {
      const prov = isProvisional(stat(counts, id), stat(losses, id), stat(streaks, id));
      return `<tr>
        <td>${rank}</td><td>${esc(title(id))}</td>
        <td>${Math.round(battle.ratings.get(id) ?? 0)}</td>
        <td>${stat(counts, id) - stat(losses, id)}–${stat(losses, id)}</td>
        <td>${stat(streaks, id)}</td>
        <td>${prov ? 'placing' : 'placed'}</td>
      </tr>`;
    };

    const totalBattles = [...counts.values()].reduce((a, b) => a + b, 0) / 2;
    const appearances = store.state.ranked.map(id => stat(counts, id));
    const historyRows = [...history].reverse().slice(0, 60).map(h => {
      const l = h.w === h.a ? h.b : h.a;
      const when = new Date(h.t).toLocaleString();
      const tag = h.p === null ? ''
        : ` · ${esc(title(h.p))} placed ${h.p === h.w ? '↑' : '↓'}`;
      return `<li><b>${esc(title(h.w))}</b> beat ${esc(title(l))}${tag}
        <span class="dim">${when}</span></li>`;
    }).join('');

    section.innerHTML = `
      <h2>Debug</h2>
      <p class="dim">${totalBattles} battles recorded in stats ·
        appearances per ranked movie: min ${Math.min(...appearances)},
        max ${Math.max(...appearances)} ·
        history entries: ${history.length} (capped at 1000)
        <button id="debug-copy" class="btn btn-ghost">Copy debug JSON</button></p>
      <div class="debug-cols">
        <table>
          <tr><th>#</th><th>movie</th><th>rating</th><th>W–L</th><th>streak</th><th>phase</th></tr>
          ${store.state.ranked.map((id, i) => row(id, i + 1)).join('')}
          ${store.state.unranked.map(id => row(id, '—')).join('')}
        </table>
        <div>
          <h3>Recent votes (newest first)</h3>
          <ol class="debug-history">${historyRows || '<li class="dim">none yet</li>'}</ol>
        </div>
      </div>`;

    section.querySelector('#debug-copy').addEventListener('click', async () => {
      const dump = {
        exportedAt: new Date().toISOString(),
        state: store.state,
        stats: {
          counts: [...counts.entries()],
          losses: [...losses.entries()],
          streaks: [...streaks.entries()],
        },
        ratings: [...battle.ratings.entries()].map(([id, r]) => [id, Math.round(r)]),
        history,
        movies: MOVIES.map(m => ({ id: m.id, title: m.title })),
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(dump, null, 1));
        section.querySelector('#debug-copy').textContent = 'Copied!';
      } catch { /* clipboard unavailable */ }
    });
  };

  store.subscribe(render);
  render();
}
