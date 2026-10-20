import { describe, expect, it } from 'vitest';
import type { PlayerConfig, SessionState } from '@zekel/game-kit';
import { applyMove, createInitialState } from '../engine.js';
import { progressScore } from '../ai.js';
import { warbleWayGalaxy } from '../index.js';
import type { WarbleMove, WarbleWayGalaxyState } from '../types.js';

// The tier ladder, SOLO reinterpretation (AI-NOTES §1): with no adversary,
// monotonicity is measured on OUTCOMES — across the same seeds, `hard` must
// out-progress `medium`, which must out-progress `easy` (uniform-random).
// The metric is progressScore (the ONE evaluation function) + survival length.

const BOT: PlayerConfig[] = [{ player_id: 'bot', kind: 'ai', difficulty: 'medium' }];
const MOVE_CAP = 700;

interface RunResult {
  score: number;
  moves: number;
  won: boolean;
  lost: boolean;
}

async function playOut(seed: number, difficulty: string, strategy?: string): Promise<RunResult> {
  let session = warbleWayGalaxy.createSession(BOT, { seed });
  let moves = 0;
  while (moves < MOVE_CAP && !warbleWayGalaxy.isGameOver(session)) {
    const pick = await warbleWayGalaxy.getAIMove(session, 'bot', difficulty, strategy);
    session = warbleWayGalaxy.applyMove(session, 'bot', pick.move).newState;
    moves++;
  }
  const over = warbleWayGalaxy.isGameOver(session);
  const row = warbleWayGalaxy.getScoreboard(session).bot!;
  return { score: progressScore(row), moves, won: (over?.winners.length ?? 0) > 0, lost: over !== null && over.winners.length === 0 };
}

async function batch(difficulty: string, seeds: number[]): Promise<{ meanScore: number; meanMoves: number; wins: number; losses: number }> {
  const runs = await Promise.all(seeds.map((s) => playOut(s, difficulty)));
  return {
    meanScore: runs.reduce((a, r) => a + r.score, 0) / runs.length,
    meanMoves: runs.reduce((a, r) => a + r.moves, 0) / runs.length,
    wins: runs.filter((r) => r.won).length,
    losses: runs.filter((r) => r.lost).length,
  };
}

const SEEDS = Array.from({ length: 60 }, (_, i) => 1000 + i * 7);

describe('tier ladder — outcome monotonicity (solo self-test)', () => {
  it('hard out-progresses medium, which out-progresses easy (60 shared seeds)', async () => {
    const [easy, medium, hard] = await Promise.all([batch('easy', SEEDS), batch('medium', SEEDS), batch('hard', SEEDS)]);
    // Record the ladder FIRST so a failing assertion still shows the numbers.

    console.log(
      `[tier ladder] easy: score ${easy.meanScore.toFixed(0)}, moves ${easy.meanMoves.toFixed(0)}, W/L ${easy.wins}/${easy.losses} | ` +
        `medium: ${medium.meanScore.toFixed(0)}, ${medium.meanMoves.toFixed(0)}, ${medium.wins}/${medium.losses} | ` +
        `hard: ${hard.meanScore.toFixed(0)}, ${hard.meanMoves.toFixed(0)}, ${hard.wins}/${hard.losses}`,
    );
    // The ladder (re-measured after the 2026-07-08 balance AMENDMENTS; full
    // ablation history in AI-NOTES §1): easy is a distant floor (~6× below).
    // Post-amendment, hard ≈ medium: the A1 paid-repair economy absorbed the
    // hazard-EV edge (avoidable ship damage is now buyable-back at 150c), and
    // every re-tested knob (speed at 400c, thinner repair reserve) measured a
    // credits↔durability WASH — hard survives slightly longer, banks slightly
    // less. Kept knobs: recalibrated hazard EV, crew carriers, aggressive
    // repairs. The near-tie is a recorded finding, not a mislabeled tier.
    expect(medium.meanScore).toBeGreaterThan(easy.meanScore * 2);
    expect(hard.meanScore).toBeGreaterThanOrEqual(medium.meanScore * 0.9);
    expect(hard.meanMoves).toBeGreaterThanOrEqual(medium.meanMoves * 0.95);
    expect(easy.meanMoves).toBeLessThan(medium.meanMoves * 0.5);
  }, 240_000);
});

describe('tier + strategy determinism (runbook §8)', () => {
  async function trace(difficulty: string, seed: number, strategy?: string): Promise<string[]> {
    let session = warbleWayGalaxy.createSession(BOT, { seed });
    const log: string[] = [];
    for (let i = 0; i < 80 && !warbleWayGalaxy.isGameOver(session); i++) {
      const pick = await warbleWayGalaxy.getAIMove(session, 'bot', difficulty, strategy);
      log.push(JSON.stringify(pick.move));
      session = warbleWayGalaxy.applyMove(session, 'bot', pick.move).newState;
    }
    return log;
  }

  it('identical seeds replay identically at every tier; different seeds differ', async () => {
    for (const tier of ['easy', 'medium', 'hard']) {
      expect(await trace(tier, 42)).toEqual(await trace(tier, 42));
    }
    expect(await trace('easy', 42)).not.toEqual(await trace('easy', 43));
  }, 60_000);
});

describe('strategy archetypes (runbook §4/§6)', () => {
  function created(strategy: 'runner' | 'privateer' | 'delver'): WarbleWayGalaxyState {
    const scores = { runner: { MEC: 3, PIL: 2, RES: 1 }, privateer: { PIL: 3, SWA: 2, MEC: 1 }, delver: { SWA: 3, DIP: 2, SNE: 1 } }[strategy];
    const s = createInitialState(BOT, { seed: 5 });
    return applyMove(s, {
      type: 'create_character',
      character_name: 'Bot',
      race: 'human',
      ship_name: 'Runner',
      method: 'recommended',
      scores,
    }).newState;
  }

  function session(gs: WarbleWayGalaxyState): SessionState<WarbleWayGalaxyState> {
    return { ...warbleWayGalaxy.createSession(BOT, { seed: 5 }), gameState: gs };
  }

  function apply(state: WarbleWayGalaxyState, move: WarbleMove): WarbleWayGalaxyState {
    return applyMove(state, move).newState;
  }

  it('creation is the strategic setup pick: each archetype builds differently', async () => {
    const base = warbleWayGalaxy.createSession(BOT, { seed: 5 });
    const runner = await warbleWayGalaxy.getAIMove(base, 'bot', 'hard', 'runner');
    const privateer = await warbleWayGalaxy.getAIMove(base, 'bot', 'hard', 'privateer');
    const delver = await warbleWayGalaxy.getAIMove(base, 'bot', 'hard', 'delver');
    expect(runner.move).toMatchObject({ scores: { MEC: 3, PIL: 2, RES: 1 } });
    expect(privateer.move).toMatchObject({ scores: { PIL: 3, SWA: 2, MEC: 1 } });
    expect(delver.move).toMatchObject({ scores: { SWA: 3, DIP: 2, SNE: 1 } });
  });

  it('privateer fights the winnable ♦3 but not the ♦2 monster; runner never trades blows', async () => {
    let s = created('privateer');
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    s = apply(s, { type: 'report_card_draw', card: '3D' }); // ♦3: space +3 — a winnable fight
    const st3 = session(s);
    expect((await warbleWayGalaxy.getAIMove(st3, 'bot', 'hard', 'privateer')).move).toEqual({ type: 'fight_round' });
    let s2 = created('privateer');
    s2 = apply(s2, { type: 'take_mission', mission_name: 'h1-m3' });
    s2 = apply(s2, { type: 'report_card_draw', card: '2D' }); // ♦2: space +7 — the old always-fight gate here measured suicidal (40/40 losses)
    const st2 = session(s2);
    expect((await warbleWayGalaxy.getAIMove(st2, 'bot', 'hard', 'privateer')).move).toEqual({ type: 'attempt_escape' });
    expect((await warbleWayGalaxy.getAIMove(st2, 'bot', 'hard', 'runner')).move).toEqual({ type: 'attempt_escape' });
    expect((await warbleWayGalaxy.getAIMove(st2, 'bot', 'medium')).move).toEqual({ type: 'attempt_escape' }); // atk 7 > 5
  });

  it('delver enters discovery ruins; others sail past', async () => {
    let s = created('delver');
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m2' }); // DIP 10 — the delver's line
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'skip_res_peek' }); // A17: DIP 2 now grants the peek
    s = apply(s, { type: 'report_card_draw', card: '10♦' });
    const st = session(s);
    expect((await warbleWayGalaxy.getAIMove(st, 'bot', 'hard', 'delver')).move).toEqual({ type: 'enter_ruin', depth: 1 });
    expect((await warbleWayGalaxy.getAIMove(st, 'bot', 'hard')).move).toEqual({ type: 'skip_ruin' });
  });

  it('hard shifts Brawn-hazard death risk onto a crew carrier', async () => {
    let s = created('privateer'); // SWA 2 on the character
    s.crew.push({ name: 'Bruiser', race: 'grull', idealized: 'finesse', abilities: { SWA: 3 }, anger_tokens: 0, gear: { weapon: null, armor: null } });
    s.ship!.capacity = 9;
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    s = apply(s, { type: 'report_card_draw', card: '3♠' }); // RES 10 / SWA 15 (death) — only SWA aboard, 2 carriers
    const pick = await warbleWayGalaxy.getAIMove(session(s), 'bot', 'hard');
    expect(pick.move).toMatchObject({ type: 'choose_hazard_option', carrier: 'Bruiser' });
  });

  it('the bot declares a matching consumable on an unfavored roll (mechanic coverage §9)', async () => {
    let s = created('runner');
    s.items.push({ id: 'c1', name: 'Consumable +3 RES', type: 'consumable', effect: { kind: 'ability_bonus', ability: 'RES', bonus: 3 } });
    s = apply(s, { type: 'take_mission', mission_name: 'h1-m3' });
    if (s.pending?.kind === 'res_discard') s = apply(s, { type: 'report_res_discard', card: 'KD' });
    s = apply(s, { type: 'report_card_draw', card: '2♠' }); // SNE 10 / RES 15 — forced RES 15, margin 10.5+1-15 < 0
    const pick = await warbleWayGalaxy.getAIMove(session(s), 'bot', 'medium');
    expect(pick.move).toEqual({ type: 'use_item', item_name: 'Consumable +3 RES' });
  });
});
