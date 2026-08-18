import { MOVIES } from './movies.js';
import { makeLogo } from './logo.js';

// Ranked + unranked lists: rendering with FLIP animations, and pointer-based
// drag-to-reorder (native HTML5 DnD doesn't work on touch).
export class RankingList {
  constructor({ store, rankedEl, unrankedEl, unrankedHead, newIds }) {
    this.store = store;
    this.rankedEl = rankedEl;
    this.unrankedEl = unrankedEl;
    this.unrankedHead = unrankedHead;
    this.newIds = new Set(newIds ?? []);

    // One <li> per movie, created once and moved around thereafter — keeps
    // images loaded and makes FLIP animations trivial.
    this.rows = new Map(MOVIES.map(m => [m.id, this.makeRow(m)]));
    this.wireDrag();
  }

  makeRow(movie) {
    const li = document.createElement('li');
    li.dataset.id = movie.id;

    const rank = document.createElement('span');
    rank.className = 'rank';

    const logo = document.createElement('span');
    logo.className = 'row-logo';
    logo.append(makeLogo(movie));

    const title = document.createElement('span');
    title.className = 'row-title';
    title.append(movie.title);
    const year = document.createElement('span');
    year.className = 'year';
    year.textContent = movie.year;
    title.append(year);
    if (this.newIds.has(movie.id)) {
      const badge = document.createElement('span');
      badge.className = 'badge-new';
      badge.textContent = 'NEW';
      title.append(badge);
    }

    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder';

    li.append(rank, logo, title, handle);
    return li;
  }

  render({ animate = false } = {}) {
    const before = animate ? this.capturePositions() : null;

    const { ranked, unranked } = this.store.state;
    for (const [i, id] of ranked.entries()) {
      const row = this.rows.get(id);
      row.querySelector('.rank').textContent = i + 1;
      this.rankedEl.append(row); // append moves the node if already in DOM
    }
    for (const id of unranked) this.unrankedEl.append(this.rows.get(id));
    // A movie promoted out of "haven't seen" is no longer new.
    for (const id of ranked) {
      if (this.newIds.delete(id)) this.rows.get(id).querySelector('.badge-new')?.remove();
    }
    this.unrankedHead.classList.toggle('hidden', unranked.length === 0);
    this.unrankedEl.classList.toggle('hidden', unranked.length === 0);

    if (before) this.playFlip(before);
  }

  capturePositions() {
    const map = new Map();
    for (const [id, row] of this.rows) {
      if (row.isConnected) map.set(id, row.getBoundingClientRect().top);
    }
    return map;
  }

  playFlip(before) {
    for (const [id, row] of this.rows) {
      const prev = before.get(id);
      if (prev === undefined || !row.isConnected) continue;
      const dy = prev - row.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) continue;
      row.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
        { duration: 350, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
  }

  wireDrag() {
    let drag = null; // { row, pointerId }

    const onMove = e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      const over = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find(el => (el.matches?.('li[data-id], .movie-list')) && el !== drag.row);
      if (!over) return;
      if (over.matches('li[data-id]')) {
        if (over.parentNode !== this.rankedEl && over.parentNode !== this.unrankedEl) return;
        const rect = over.getBoundingClientRect();
        const beforeTarget = e.clientY < rect.top + rect.height / 2;
        over.parentNode.insertBefore(drag.row, beforeTarget ? over : over.nextSibling);
      } else if (!over.contains(drag.row)) {
        over.append(drag.row);
      }
      this.renumber();
    };

    const onEnd = e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const { row } = drag;
      drag = null;
      row.classList.remove('dragging');
      document.body.classList.remove('drag-active');
      const id = Number(row.dataset.id);
      const inUnranked = row.parentNode === this.unrankedEl;
      const index = [...row.parentNode.children].indexOf(row);
      this.store.move(id, inUnranked, index, { cause: 'drag' });
    };

    for (const listEl of [this.rankedEl, this.unrankedEl]) {
      listEl.addEventListener('pointerdown', e => {
        const handle = e.target.closest('.handle');
        if (!handle || drag) return;
        const row = handle.closest('li[data-id]');
        drag = { row, pointerId: e.pointerId };
        handle.setPointerCapture(e.pointerId);
        row.classList.add('dragging');
        document.body.classList.add('drag-active');
        this.renumber(); // reveal the unranked drop zone immediately
      });
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onEnd);
    document.addEventListener('pointercancel', onEnd);
  }

  // Live rank numbers while dragging, before the store commit.
  renumber() {
    [...this.rankedEl.children].forEach((row, i) => {
      row.querySelector('.rank').textContent = i + 1;
    });
    const empty = this.unrankedEl.children.length === 0;
    this.unrankedHead.classList.toggle('hidden', empty && !document.body.classList.contains('drag-active'));
    this.unrankedEl.classList.toggle('hidden', empty && !document.body.classList.contains('drag-active'));
  }
}
