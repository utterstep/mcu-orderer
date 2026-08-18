import { MOVIES } from './movies.js';
import { seedRatings, updateRatings, orderByRating } from './elo.js';
import { pickPair } from './matchmaking.js';
import { makeLogo } from './logo.js';

const SWIPE_THRESHOLD = 70; // px of horizontal drag that commits a vote
const TAP_SLOP = 8;

export class Battle {
  constructor({ store, section, onUnseen }) {
    this.store = store;
    this.section = section;
    this.onUnseen = onUnseen;
    this.cards = [...section.querySelectorAll('.battle-card')];
    this.countEl = section.querySelector('#battle-count');
    this.ratings = seedRatings(store.state.ranked);
    this.counts = new Map();
    this.battleCount = 0;
    this.pair = null;
    this.locked = false; // ignore input during fly-out animation

    for (const [side, card] of this.cards.entries()) {
      this.wireCard(card, side);
      card.querySelector('.unseen').addEventListener('click', e => {
        e.stopPropagation();
        if (this.pair) this.onUnseen(this.pair[side]);
      });
    }
  }

  // Called when the order changed outside of a battle (drag, unseen, fork,
  // reset): the order is the truth, so ratings restart from it.
  reseed({ clearCounts = false } = {}) {
    this.ratings = seedRatings(this.store.state.ranked);
    if (clearCounts) {
      this.counts = new Map();
      this.battleCount = 0;
      this.updateCount();
    }
    this.next();
  }

  next() {
    this.pair = pickPair(
      this.store.state.ranked, this.ratings, this.counts, this.pair, Math.random,
    );
    const arena = this.section.querySelector('.arena');
    const hint = this.section.querySelector('.battle-hint:not(.battle-empty)');
    const empty = this.section.querySelector('.battle-empty');
    arena.hidden = hint.hidden = !this.pair;
    empty.hidden = !!this.pair;
    if (!this.pair) return;
    for (const [side, card] of this.cards.entries()) {
      const movie = MOVIES[this.pair[side]];
      const logo = card.querySelector('.card-logo');
      logo.replaceChildren(makeLogo(movie));
      card.querySelector('.card-year').textContent = movie.year;
      card.style.transform = '';
      card.classList.remove('fly-out');
      card.classList.add('fly-in');
      card.addEventListener('animationend', () => card.classList.remove('fly-in'), { once: true });
    }
    this.locked = false;
  }

  vote(side) {
    if (this.locked || !this.pair) return;
    this.locked = true;
    const [winner, loser] = side === 0 ? this.pair : [this.pair[1], this.pair[0]];
    const [rw, rl] = updateRatings(this.ratings.get(winner), this.ratings.get(loser));
    this.ratings.set(winner, rw).set(loser, rl);
    for (const id of this.pair) this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    this.battleCount++;
    this.updateCount();

    const { ranked, unranked } = this.store.state;
    this.store.set(
      { ranked: orderByRating(ranked, this.ratings), unranked },
      { cause: 'battle' },
    );

    const [chosen, other] = side === 0 ? this.cards : [this.cards[1], this.cards[0]];
    chosen.style.transform = 'scale(1.06)';
    other.style.transform = 'scale(0.94)';
    for (const c of this.cards) c.classList.add('fly-out');
    setTimeout(() => this.next(), 260);
  }

  updateCount() {
    this.countEl.textContent = `${this.battleCount} battle${this.battleCount === 1 ? '' : 's'}`;
  }

  wireCard(card, side) {
    let start = null;
    card.addEventListener('pointerdown', e => {
      if (this.locked || e.target.closest('.unseen')) return;
      start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      card.setPointerCapture(e.pointerId);
      card.classList.add('dragging-card');
    });
    card.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      card.style.transform = `translateX(${dx}px) rotate(${dx * 0.06}deg)`;
    });
    const finish = e => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      card.classList.remove('dragging-card');
      if (Math.abs(dx) >= SWIPE_THRESHOLD || Math.hypot(dx, dy) <= TAP_SLOP) {
        this.vote(side);
      } else {
        card.style.transition = 'transform 0.2s';
        card.style.transform = '';
        setTimeout(() => { card.style.transition = ''; }, 200);
      }
    };
    card.addEventListener('pointerup', finish);
    card.addEventListener('pointercancel', finish);
  }
}
