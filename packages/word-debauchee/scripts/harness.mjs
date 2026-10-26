// Plays all-AI rounds and reports what the AI does: crack rate, reveals
// before a crack, and payouts, per debauchee tier × guesser tier and per card
// difficulty. This shows what the AI does, not whether the game is balanced;
// balance is the designer's playtest. Build first:
//   pnpm --filter @zekel/word-debauchee build:words && pnpm build
//   node packages/word-debauchee/scripts/harness.mjs [rounds-per-pairing] [guessers]

import { chooseAIMove } from '../dist/ai.js';
import { cardFor } from '../dist/data/deck.js';
import { applyMove } from '../dist/engine/apply.js';
import { activeSeatId } from '../dist/engine/helpers.js';
import { createState } from '../dist/engine/round.js';

const ROUNDS = Number(process.argv[2] ?? 200);
const GUESSERS = Number(process.argv[3] ?? 2);
const TIERS = ['easy', 'medium', 'hard'];

function playRounds(debTier, guessTier, rounds, seed) {
  const seats = [{ id: 'd', name: 'Debauchee', ai: true }, ...Array.from({ length: GUESSERS }, (_, i) => ({ id: `g${i}`, name: `Guesser ${i + 1}`, ai: true }))];
  const results = [];
  let s = createState(seats, { seed, firstDebauchee: 'd', rounds });
  // The same seat stays debauchee: rotate by re-dealing with firstDebauchee pinned each round.
  let guard = 0;
  while (s.phase !== 'game_over') {
    if (++guard > 20000) throw new Error('stuck');
    const id = activeSeatId(s);
    const tier = id === 'd' ? debTier : guessTier;
    if (s.round.debauchee !== 'd') {
      // Not our pairing's round: let it finish fast (guessers call reveals).
      const m = id === s.round.debauchee ? chooseAIMove(s, id, 'easy', guard) : { type: 'call_reveal' };
      s = applyMove(s, id, m).newState;
      continue;
    }
    s = applyMove(s, id, chooseAIMove(s, id, tier, seed + guard)).newState;
    if (s.history.length > results.length && s.history[s.history.length - 1].debauchee === 'd') results.push(s.history[s.history.length - 1]);
  }
  return results;
}

function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : '-';
}

console.log(`Word Debauchee harness: ${ROUNDS} debauchee rounds per pairing, ${GUESSERS} AI guesser(s), laps timer.\n`);
console.log('debauchee  guessers   rounds  cracked  stump%   reveals/crack  guesser pay/crack  debauchee pay/round');
const byDifficulty = new Map();
for (const d of TIERS) {
  for (const g of TIERS) {
    // Each game has (GUESSERS+1) rounds per rotation; we keep only the pinned debauchee's.
    const perGame = GUESSERS + 1;
    const games = Math.ceil(ROUNDS / 1);
    let rows = [];
    let seed = 1000;
    while (rows.length < ROUNDS) {
      rows.push(...playRounds(d, g, perGame, seed++));
    }
    rows = rows.slice(0, ROUNDS);
    const cracked = rows.filter((r) => r.outcome === 'cracked');
    const stumpPct = (100 * (rows.length - cracked.length)) / rows.length;
    const revealsPerCrack = cracked.reduce((a, r) => a + r.revealed, 0) / cracked.length;
    const payPerCrack = cracked.reduce((a, r) => a + r.payouts.g0, 0) / cracked.length;
    const debPay = rows.reduce((a, r) => a + r.payouts.d, 0) / rows.length;
    console.log(`${d.padEnd(10)} ${g.padEnd(10)} ${String(rows.length).padStart(6)}  ${String(cracked.length).padStart(7)}  ${fmt(stumpPct, 0).padStart(5)}%  ${fmt(revealsPerCrack).padStart(13)}  ${fmt(payPerCrack).padStart(17)}  ${fmt(debPay).padStart(19)}`);
    for (const r of rows) {
      const diff = cardFor(r.word).difficulty;
      const key = `${d}/${g}/${diff}`;
      const e = byDifficulty.get(key) ?? { n: 0, cracked: 0, reveals: 0, pay: 0 };
      e.n++;
      if (r.outcome === 'cracked') {
        e.cracked++;
        e.reveals += r.revealed;
        e.pay += r.payouts.g0;
      }
      byDifficulty.set(key, e);
    }
  }
}
console.log('\nBy card difficulty (hard debauchee vs hard guessers, medium vs medium):');
console.log('pairing          difficulty  rounds  cracked  stump%  reveals/crack  pay/crack');
for (const pairing of ['hard/hard', 'medium/medium', 'easy/easy']) {
  for (const diff of [1, 2, 3]) {
    const e = byDifficulty.get(`${pairing}/${diff}`);
    if (!e) continue;
    console.log(`${pairing.padEnd(16)} ${'●'.repeat(diff).padEnd(3, '○').padEnd(11)} ${String(e.n).padStart(6)}  ${String(e.cracked).padStart(7)}  ${fmt((100 * (e.n - e.cracked)) / e.n, 0).padStart(5)}%  ${fmt(e.reveals / e.cracked).padStart(13)}  ${fmt(e.pay / e.cracked).padStart(9)}`);
  }
}
console.log('\nDesign-notes expectations: ●○○ cracked with 0–1 reveals most of the time (guesser pay 3–6); ●●● stumps about a third of the time (debauchee pay 8–10).');
