import { MOVIES } from './movies.js';
import {
  seedRatings, updateRatings, placementRating, orderByRating, MIN_PLACE,
} from './elo.js';
import { pickPair, pickPlacer } from './matchmaking.js';
import { loadStats, saveStats } from './state.js';
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
    ({ counts: this.counts, losses: this.losses } = loadStats());
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
      this.losses = new Map();
      saveStats(this.counts, this.losses);
      this.battleCount = 0;
      this.updateCount();
    }
    this.next();
  }

  // A manual drag is definitive information: end the movie's placement phase
  // so battles refine around the dragged position instead of teleporting it.
  establish(id) {
    this.counts.set(id, Math.max(this.counts.get(id) ?? 0, MIN_PLACE));
    this.losses.set(id, Math.max(this.losses.get(id) ?? 0, 1));
    saveStats(this.counts, this.losses);
  }

  next() {
    this.pair = pickPair(
      this.store.state.ranked, this.ratings, this.counts, this.losses,
      this.pair, Math.random,
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
    const placer = pickPlacer(this.pair, this.ratings, this.counts, this.losses);
    const [nw, nl] = updateRatings(this.ratings.get(winner), this.ratings.get(loser));
    if (placer === null) {
      this.ratings.set(winner, nw).set(loser, nl);
    } else {
      // Provisional movie jumps beside its opponent; the opponent only takes
      // the gentle Elo delta, so an established order can't be wrecked.
      const opp = this.pair[0] === placer ? this.pair[1] : this.pair[0];
      const oppBefore = this.ratings.get(opp);
      this.ratings.set(opp, opp === winner ? nw : nl);
      this.ratings.set(placer, placementRating(this.ratings.get(placer), oppBefore, placer === winner));
    }
    for (const id of this.pair) this.counts.set(id, (this.counts.get(id) ?? 0) + 1);
    this.losses.set(loser, (this.losses.get(loser) ?? 0) + 1);
    saveStats(this.counts, this.losses);
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
    let text = `${this.battleCount} battle${this.battleCount === 1 ? '' : 's'}`;
    // Confidence hint: expected average rank error for this many total votes,
    // fitted from simulations of the placement+Elo scheme on 38 movies
    // (error ≈ 11.5·e^(−total/170)). Drags/adopts count via persisted stats.
    let total = 0;
    for (const c of this.counts.values()) total += c;
    total = Math.floor(total / 2);
    if (total >= 10) {
      const wiggle = Math.round(11.5 * Math.exp(-total / 170));
      text += wiggle <= 1 ? ' · ranking dialed in' : ` · roughly ±${wiggle} slots`;
    }
    this.countEl.textContent = text;
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
