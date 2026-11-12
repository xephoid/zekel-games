// The strike moment's beats: both lanes at once, what got through read from
// the lane (never worked out), a hit stopped whole gets "Blocked!", the lost
// blocks break off, K.O. only when the game ends, and pace, skip and reduced
// motion keep the same beats.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StrikeMoment } from '../StrikeMoment.js';
import { STRIKE_BEATS, StrikeOverlay } from '../StrikeMoment.js';

const MOMENT: StrikeMoment = {
  kind: 'strike', key: 'strike:3', title: 'Round 3 · strike', over: false,
  lanes: [
    // You hit them for 3 into 1 defense; the engine took 2 off.
    { attacker: 'p1', target: 'p2', hit: 3, shield: 1, through: 2, before: 6, after: 4, max: 7 },
    // They hit you for 1 into 2 defense; nothing got through.
    { attacker: 'p2', target: 'p1', hit: 1, shield: 2, through: 0, before: 5, after: 5, max: 7 },
  ],
};

function play(moment: StrikeMoment, opts: { pace?: 0.5 | 1 | 2; reduced?: boolean } = {}) {
  const onDone = vi.fn();
  const r = render(
    <StrikeOverlay moment={moment} nameFor={(pid) => (pid === 'p2' ? 'AI' : pid)} youPid="p1" pace={opts.pace ?? 1} setPace={vi.fn()} onDone={onDone} reduced={opts.reduced ?? false} />,
  );
  return { ...r, onDone };
}

/** Run the clock through the named beats, at a pace. */
function through(beats: Array<keyof typeof STRIKE_BEATS>, pace = 1) {
  for (const b of beats) act(() => { vi.advanceTimersByTime(STRIKE_BEATS[b] / pace + 1); });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the strike moment', () => {
  it('runs both lanes together and names who hits whom', () => {
    const { container } = play(MOMENT);
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('dialog', { name: 'Round 3 · strike' })).toBeTruthy();
    expect(screen.getByText('Round 3')).toBeTruthy();
    const hits = [...container.querySelectorAll('.strike-hit')];
    expect(hits.map((h) => h.className)).toEqual(['strike-hit left at-home', 'strike-hit right at-home']);
    expect(screen.getByRole('img', { name: 'You hit AI: 3 queued' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'AI hits you: 1 queued' })).toBeTruthy();
    through(['locked']);
    expect([...container.querySelectorAll('.strike-hit')].every((h) => h.classList.contains('at-across'))).toBe(true);
  });

  it('at the absorb each hit shows what got through, from the lane, and each shield tags what it blocked', () => {
    const { container } = play(MOMENT);
    through(['locked', 'travel']);
    expect(screen.getByRole('img', { name: 'You hit AI: 3 queued, 2 got through' }).textContent).toBe('2');
    expect(screen.getByRole('img', { name: 'AI hits you: 1 queued, 0 got through' }).textContent).toBe('0');
    const tags = [...container.querySelectorAll('.strike-block-tag')].map((t) => t.textContent);
    expect(tags.sort()).toEqual(['Block 1', 'Block 1']);
    expect(screen.getByText('AI blocks 1. You block 1.')).toBeTruthy();
  });

  it('at the land what got through bursts on the target, the lost blocks break off, and a hit stopped whole is Blocked!', () => {
    const { container } = play(MOMENT);
    through(['locked', 'travel', 'absorb']);
    const right = container.querySelector('.strike-fighter.right')!;
    expect(right.classList.contains('struck')).toBe(true);
    expect(right.querySelectorAll('.strike-pip.out')).toHaveLength(2);
    expect(right.querySelectorAll('.strike-pip.full')).toHaveLength(4);
    expect(container.querySelector('.strike-impact.right')!.textContent).toBe('−2');
    // You lost nothing: your plate does not shake, and your shield says so.
    const left = container.querySelector('.strike-fighter.left')!;
    expect(left.classList.contains('struck')).toBe(false);
    expect(left.querySelectorAll('.strike-pip.out')).toHaveLength(0);
    expect(container.querySelector('.strike-shield.left .strike-stamp')!.textContent).toBe('Blocked!');
    expect(container.querySelector('.strike-shield.right .strike-stamp')).toBeNull();
    expect(container.querySelector('.strike-ko')).toBeNull();
  });

  it('K.O. stamps on the land when the strike ends the game, then hands over', () => {
    const { container, onDone } = play({ ...MOMENT, over: true });
    through(['locked', 'travel', 'absorb']);
    expect(container.querySelector('.strike-ko')!.textContent).toBe('K.O.');
    through(['land', 'fade']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('closes itself after the five beats; the pace scales every beat; skip closes it at once', () => {
    const a = play(MOMENT, { pace: 2 });
    through(['locked', 'travel', 'absorb', 'land'], 2);
    expect(a.onDone).not.toHaveBeenCalled();
    expect(a.container.querySelector('.strike-scrim')!.classList.contains('closing')).toBe(true);
    through(['fade'], 2);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    cleanup();
    const b = play(MOMENT);
    fireEvent.click(screen.getByRole('button', { name: 'Skip to the end' }));
    expect(b.onDone).toHaveBeenCalledTimes(1);
  });

  it('reduced motion keeps the same beats', () => {
    const { container, onDone } = play(MOMENT, { reduced: true });
    expect(container.querySelector('.strike-scrim')!.classList.contains('reduced')).toBe(true);
    through(['locked', 'travel', 'absorb', 'land', 'fade']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
