// The NGnG purchase composer against engine views: choose, see the payment,
// place it, and exactly one listed move goes out — only on the last press.

import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GameReferenceResponse, LegalMove, UnavailableMove } from '@zekel/wire-types';
import type { GlueInput } from '@zekel/glue-kit';
import { isSubmissionAllowed } from '@zekel/glue-kit';
import { NggScreen } from '../table/NggScreen.js';
import REFERENCE from './fixtures/ngg-reference.json';
// A pinned view: these tests name the items it offers (fixtures/ngg-pinned/README.md).
import BUILD from './fixtures/ngg-pinned/action-build-base.json';
import ACCESS from './fixtures/ngg/pending-access_request-queue.json';
import SMYTH from './fixtures/ngg-pinned/pending-smyth_reward-multi.json';
import ROBOT_MID from './fixtures/ngg-pinned/action-build-robot-mid.json';

interface Fixture { viewer: string; view: unknown; legalMoves: LegalMove[]; unavailable?: UnavailableMove[]; watcher: string; watcherView: unknown; watcherLegalMoves: LegalMove[] }

const ALL_NGG: Record<string, Fixture> = Object.fromEntries(
  Object.entries(import.meta.glob<Fixture>('./fixtures/ngg/*.json', { eager: true, import: 'default' }))
    .map(([path, f]) => [path.replace(/^.*\//, '').replace(/\.json$/, ''), f]),
);

afterEach(cleanup);

function draw(f: Fixture, opts: { as?: 'viewer' | 'watcher'; legal?: LegalMove[]; unavailable?: UnavailableMove[] } = {}) {
  const watcher = opts.as === 'watcher';
  const legal = opts.legal ?? (watcher ? f.watcherLegalMoves : f.legalMoves);
  const onMove = vi.fn();
  const onForm = vi.fn();
  const input: GlueInput = {
    view: watcher ? f.watcherView : f.view, previous: null, legalMoves: legal, unavailable: opts.unavailable,
    playerId: watcher ? f.watcher : f.viewer, reference: REFERENCE as GameReferenceResponse,
    seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(),
  };
  render(<NggScreen input={input} yourTurn={!watcher} busy={false} interactive nameFor={(p) => p} onMove={onMove} onForm={onForm} />);
  return { onMove, onForm, legal };
}

/** A listed purchase the fixture offers that is paid for and not placed. */
function paidItem(f: Fixture): { item: string; listed: LegalMove } {
  const listed = f.legalMoves.find((m) => m.move['type'] === 'build' && !('at_base' in m.move)
    && Array.isArray(m.move['payment']) && (m.move['payment'] as unknown[]).length > 1)!;
  return { item: String(listed.move['item']), listed };
}
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const press = (name: RegExp | string) => fireEvent.click(screen.getAllByRole('button', { name })[0]!);

describe("NGnG research prices follow the buyer's species", () => {
  it("a robot's Extra action cards cost oil, not the wizard's ether (the two share names)", () => {
    const f = ALL_NGG['action-research-robot-extra']!;
    draw(f, { unavailable: (f as unknown as { unavailable: UnavailableMove[] }).unavailable });
    const row = [...document.querySelectorAll('.ngg-option')].find((el) => el.textContent?.includes('Extra Build Card'))!;
    expect(row).toBeTruthy();
    const priced = [...row.querySelectorAll('.ngg-res')].map((el) => el.getAttribute('title'));
    expect(priced).toContain('1 oil');
    expect(priced.some((t) => t?.includes('ether'))).toBe(false);
  });
});

describe('NGnG build composer', () => {
  it('walks choose → pay and sends the listed move only on commit', () => {
    const { item } = paidItem(BUILD as Fixture);
    const { onMove, onForm, legal } = draw(BUILD as Fixture);
    press(new RegExp(`^${esc(item)}`));
    expect(onMove).not.toHaveBeenCalled();
    press(`Choose ${item}`);
    expect(onMove).not.toHaveBeenCalled();
    // The payment is the engine's proposal, drawn as placements to commit.
    expect(screen.getByText(`Pay for ${item}`)).toBeTruthy();
    press('Commit payment');
    expect(onMove).toHaveBeenCalledTimes(1);
    const sent = onMove.mock.calls[0]![0] as LegalMove;
    expect(sent.move['item']).toBe(item);
    expect(isSubmissionAllowed('tap', sent.move, legal)).toBe(true);
    expect(onForm).not.toHaveBeenCalled();
  });

  it('drops the purchase with no server call', () => {
    const { onMove, onForm } = draw(BUILD as Fixture);
    press(/^Core/);
    press('Choose Core');
    press('Drop the purchase');
    expect(screen.getByText('Buy one thing')).toBeTruthy();
    expect(onMove).not.toHaveBeenCalled();
    expect(onForm).not.toHaveBeenCalled();
  });

  it('asks where a piece goes when the engine lists one move per base, and never picks for you', () => {
    const f = BUILD as Fixture;
    // Two listed spawns for the platform, as the engine lists them per base.
    const base = f.legalMoves.find((m) => m.move['item'] === 'Immobile Combat Platform')!;
    const legal = [
      ...f.legalMoves.filter((m) => m !== base),
      { ...base, move: { ...base.move, at_base: '2,4' } },
      { ...base, move: { ...base.move, at_base: '1,3' } },
    ];
    const { onMove } = draw(f, { legal });
    press(/^Immobile Combat Platform/);
    press('Choose Immobile Combat Platform');
    press('Commit payment, then place it');
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('Immobile Combat Platform is in hand')).toBeTruthy();
    press(/^F2/);
    expect(onMove).toHaveBeenCalledTimes(1);
    const sent = (onMove.mock.calls[0]![0] as LegalMove).move;
    expect(sent['at_base']).toBe('1,3');
    expect(isSubmissionAllowed('tap', sent, legal)).toBe(true);
  });

  it('places a new base only on a site the engine lists, even when there is one', () => {
    const f = BUILD as Fixture;
    const sites = f.legalMoves.filter((m) => m.move['item'] === 'Home').map((m) => m.move['at_base']);
    expect(sites.length).toBeGreaterThan(0);
    const { onMove } = draw(f);
    press(/^Home/);
    press('Choose Home');
    press('Commit payment, then place it');
    // One listed site is still a choice to press, not one made for you.
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByText('Home is in hand')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /New base here/ })[0]!);
    const sent = (onMove.mock.calls[0]![0] as LegalMove).move;
    expect(sites).toContain(sent['at_base']);
    expect(isSubmissionAllowed('tap', sent, f.legalMoves)).toBe(true);
  });

  it('skips only when Skip is pressed', () => {
    const { onMove } = draw(BUILD as Fixture);
    expect(onMove).not.toHaveBeenCalled();
    press('Skip this action');
    expect((onMove.mock.calls[0]![0] as LegalMove).move).toEqual({ type: 'skip_action' });
  });
});

describe('NGnG access request', () => {
  it('interrupts the owner with the declared purchase and sends their answer', () => {
    const { onMove, legal } = draw(ACCESS as Fixture);
    expect(screen.getByRole('dialog', { name: /out of turn/ })).toBeTruthy();
    expect(screen.getByText(/asks to stand one collector on G3/)).toBeTruthy();
    press('Allow');
    const sent = (onMove.mock.calls[0]![0] as LegalMove).move;
    expect(sent).toEqual({ type: 'respond_access_request', grant: true });
    expect(isSubmissionAllowed('tap', sent, legal)).toBe(true);
  });

  it('shows the buyer the same terms, with nothing to press', () => {
    draw(ACCESS as Fixture, { as: 'watcher' });
    expect(screen.queryByRole('dialog', { name: /out of turn/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
    expect(screen.getByText(/has to agree/)).toBeTruthy();
  });
});

describe("NGnG Smyth's reward", () => {
  it('offers each listed technology free and sends the one pressed', () => {
    const { onMove } = draw(SMYTH as Fixture);
    press(/^Take Metal Platforms/);
    expect((onMove.mock.calls[0]![0] as LegalMove).move).toEqual({ type: 'research', kind: 'tech', tech: 'Metal Platforms', payment: [] });
  });
});

describe('NGnG payment, placed by the person on tiles the engine names', () => {
  // A stand-in for the engine's collector_reach: the free collectors are the
  // ones the listed payment uses, and each may go on any of the listed tiles
  // not yet taken. The screen asks after every placement.
  function reachFor(payment: Array<{ collectorId: string; coord: string }>) {
    const asked: unknown[] = [];
    const ask = vi.fn(async (_name: string, args: Record<string, unknown>) => {
      asked.push(args);
      const prior = (args['prior'] as typeof payment) ?? [];
      const taken = new Set(prior.map((p) => p.coord));
      return {
        answer: {
          collectors: payment.map((p) => ({ id: p.collectorId, resource: null, placed_at: prior.find((x) => x.collectorId === p.collectorId)?.coord ?? null })),
          next: Object.fromEntries(payment.filter((p) => !prior.some((x) => x.collectorId === p.collectorId)).map((p) => [p.collectorId, payment.map((q) => q.coord).filter((c) => !taken.has(c))])),
          produced: {}, access_needed: [],
          // Covered once every listed placement is down (the engine's word, stood in for here).
          covers: prior.length === payment.length, short: prior.length === payment.length ? {} : { water: 1 }, short_either: null,
        },
      };
    });
    return { ask, asked };
  }

  async function waitForLitHex(): Promise<HTMLButtonElement> {
    for (let i = 0; i < 50; i++) {
      const hex = document.querySelector('button.ngg-hex') as HTMLButtonElement | null;
      if (hex) return hex;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('no lit hex');
  }
  async function waitForEnabled(name: string) {
    for (let i = 0; i < 50; i++) {
      const b = screen.queryByRole('button', { name }) as HTMLButtonElement | null;
      if (b && !b.disabled) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`${name} never enabled`);
  }

  function drawLive(f: Fixture, ask: (n: string, a: Record<string, unknown>) => Promise<{ answer: unknown }>) {
    const onMove = vi.fn();
    const onForm = vi.fn();
    const input: GlueInput = {
      view: f.view, previous: null, legalMoves: f.legalMoves, playerId: f.viewer, reference: REFERENCE as GameReferenceResponse,
      seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(),
    };
    render(<NggScreen input={input} yourTurn busy={false} interactive nameFor={(p) => p} onMove={onMove} onForm={onForm} ask={ask} />);
    return { onMove, onForm };
  }

  it('starts empty, places what the person clicks, and sends the listed template with only its payment changed', async () => {
    const f = BUILD as Fixture;
    const { item, listed } = paidItem(f);
    const payment = listed.move['payment'] as Array<{ collectorId: string; coord: string }>;
    const { ask, asked } = reachFor(payment);
    const { onMove, onForm } = drawLive(f, ask);
    press(new RegExp(`^${esc(item)}`));
    press(`Choose ${item}`);
    await screen.findByText('Take a collector from your hand, then click a lit hex.');
    // Nothing is placed for the person: committing is shut until they place.
    expect((screen.getByRole('button', { name: 'Commit payment' }) as HTMLButtonElement).disabled).toBe(true);
    // Take a collector, click the second listed tile (not the one the proposal would use first).
    fireEvent.click(await screen.findByRole('button', { name: /^Surf|collector/ }));
    const target = payment[1]!.coord;
    const tile = document.querySelector(`button.ngg-hex[aria-label^="${(f.view as { map: { tiles: Array<{ coord: string; label: string }> } }).map.tiles.find((t) => t.coord === target)!.label}"]`) as HTMLButtonElement;
    expect(tile).toBeTruthy();
    fireEvent.click(tile);
    await screen.findByRole('button', { name: /^Take back/ });
    expect(asked.at(-1)).toMatchObject({ prior: [{ collectorId: payment[0]!.collectorId, coord: target }], purchase: listed.move });
    // Not yet covered: the engine says what is short, and Commit stays shut.
    expect(screen.getByText('Still needs')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Commit payment' }) as HTMLButtonElement).disabled).toBe(true);
    // Place the rest, one lit tile at a time, until the engine says it covers.
    for (let i = 1; i < payment.length; i++) {
      const take = document.querySelector('button.ngg-eco-take:not([disabled])') as HTMLButtonElement | null;
      if (take && take.getAttribute('aria-pressed') !== 'true') fireEvent.click(take);
      const hex = await waitForLitHex();
      fireEvent.click(hex);
      await screen.findAllByRole('button', { name: /^Take back/ }).then((b) => expect(b.length).toBe(i + 1));
    }
    await waitForEnabled('Commit payment');
    press('Commit payment');
    expect(onMove).not.toHaveBeenCalled();
    expect(onForm).toHaveBeenCalledTimes(1);
    const [template, move, keys] = onForm.mock.calls[0]!;
    expect(template).toBe(listed);
    expect(move['payment'][0]).toEqual({ collectorId: payment[0]!.collectorId, coord: target });
    expect(move['payment']).toHaveLength(payment.length);
    expect(isSubmissionAllowed('form', move, f.legalMoves, { template: listed.move, editableKeys: keys })).toBe(true);
  });

  it("a Haste bank that covers the price opens Commit with nothing placed, and says what it pays", async () => {
    const f = BUILD as Fixture;
    const { item, listed } = paidItem(f);
    const ask = vi.fn(async () => ({
      answer: { collectors: [], next: {}, produced: {}, access_needed: [], bank: { water: 2 }, covers: true, short: {}, short_either: null },
    }));
    const { onForm } = drawLive(f, ask);
    press(new RegExp(`^${esc(item)}`));
    press(`Choose ${item}`);
    await screen.findByText('From your bank');
    await waitForEnabled('Commit payment');
    press('Commit payment');
    expect(onForm.mock.calls[0]![1]['payment']).toEqual([]);
    expect(onForm.mock.calls[0]![0]).toBe(listed);
  });

  it("takes the engine's proposal only when the person presses for it", async () => {
    const f = BUILD as Fixture;
    const { item, listed } = paidItem(f);
    const payment = listed.move['payment'] as Array<{ collectorId: string; coord: string }>;
    const { ask } = reachFor(payment);
    const { onForm } = drawLive(f, ask);
    press(new RegExp(`^${esc(item)}`));
    press(`Choose ${item}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Choose for me' }));
    await screen.findAllByRole('button', { name: /^Take back/ });
    await waitForEnabled('Commit payment');
    // Each dashed collector already is the collector it will become, so
    // committing turns it solid in place rather than flying a second one in.
    for (const p of payment) {
      expect(document.querySelector(`[data-flip-id="ngg-collector:${f.viewer}:${p.collectorId}"]`)).toBeTruthy();
    }
    press('Commit payment');
    expect(onForm.mock.calls[0]![1]['payment']).toEqual(payment);
  });
  it('Research: a blocked purchase is struck through with the engine\'s reason and cannot be picked', () => {
    const f = ALL_NGG['action-research-tech']!;
    const { onMove, onForm } = draw(f, { unavailable: f.unavailable });
    const shut = f.unavailable!.find((u) => u.item === 'battle strategy card')!;
    const row = screen.getByText('Draw a battle card').closest('.ngg-option')!;
    expect(row.classList.contains('shut')).toBe(true);
    expect(row.textContent!.toLowerCase()).toContain(shut.reason.toLowerCase());
    expect(row.tagName).not.toBe('BUTTON');
    fireEvent.click(row);
    expect(document.querySelector('.ngg-option[aria-pressed="true"], .ngg-option.selected')).toBeNull();
    expect(onMove).not.toHaveBeenCalled();
    expect(onForm).not.toHaveBeenCalled();
  });

  it('Build: every blocked unit and building shows after the open ones, each with its reason', () => {
    const f = ALL_NGG['action-build']!;
    draw(f, { unavailable: f.unavailable });
    const items = f.unavailable!.filter((u) => (u.moveType === 'build' && u.item) || u.moveType === 'economic_victory_spend');
    expect(items.length).toBeGreaterThan(0);
    const shutRows = [...document.querySelectorAll('.ngg-option.shut')];
    expect(shutRows).toHaveLength(items.length);
    const all = [...document.querySelectorAll('.ngg-option')];
    // Open purchases first, then the shut ones.
    expect(all.findIndex((r) => r.classList.contains('shut'))).toBe(all.length - shutRows.length);
  });

  it('a watcher sees no blocked purchases: the reasons are the deciding seat\'s own', () => {
    const f = ALL_NGG['action-research-tech']!;
    draw(f, { as: 'watcher', unavailable: f.unavailable });
    expect(document.querySelectorAll('.ngg-option.shut')).toHaveLength(0);
  });
  it('a platform the engine lists both ways asks which Core, choosing nothing for the person', () => {
    const f = ROBOT_MID as Fixture;
    for (const way of ['buy', 'reserve'] as const) {
      const { onMove, onForm } = draw(f);
      fireEvent.click(screen.getAllByRole('button', { name: /^Water collector/ })[0]!);
      const choose = screen.getByRole('button', { name: /^Choose/ }) as HTMLButtonElement;
      const group = screen.getByRole('group', { name: /Which Core goes in the Water collector/ });
      // Nothing is picked for the person, and nothing moves on until they pick.
      expect(group.querySelectorAll('.ngg-option.selected')).toHaveLength(0);
      expect(choose.disabled).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: way === 'buy' ? /Buy a new Core with it/ : /A Core from your reserve/ }));
      expect(choose.disabled).toBe(false);
      fireEvent.click(choose);
      fireEvent.click(screen.getByRole('button', { name: /^Commit payment/ }));
      expect(onForm).not.toHaveBeenCalled();
      expect(onMove).toHaveBeenCalledTimes(1);
      const sent = onMove.mock.calls[0]![0] as { move: Record<string, unknown> };
      expect(sent.move['item']).toBe('Water collector');
      expect(sent.move['core_pairing'] === true).toBe(way === 'buy');
      cleanup();
    }
  });
});
