// NGnG screens: the economy. One composer walks a purchase through three
// stages — choose what to buy, see where the collectors go, place the piece —
// and sends ONE move at the end (SCREEN-ROUTING §2b). Nothing reaches the
// engine before the last press, and every stage can be backed out of with no
// server call. The same composer serves Build, a second purchase, Research
// and the economic spend. Access Request is the interrupt that can arrive on
// another seat in the middle of it.
//
// Where the engine lists a choice, the screen offers exactly that list:
// the items are the listed build moves, the spawn base or new-base site is
// the listed moves' at_base, and the payment is the one the engine proposes.

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LegalMove } from '@zekel/glue-kit';
import type { ComponentType } from 'react';
import type { ScreenCtx } from '../ctx.js';
import type { ScreenKey } from '../route.js';
import type { MapProposal } from '../HexMap.js';
import { TableLayout } from '../Layout.js';
import { economicCollectorsFor, itemByName, researchByName, heroById, type Cost } from '../ref.js';
import { TERRAIN } from '../factions.js';
import { Actions, BattleCardPrice, Btn, CostChips, HowTo, Icon, OptionRow, Panel, ResourceChip, Rule, SeatBand } from '../ui.js';
import { moveType } from '../read.js';
import { DiplomacyPanel } from './round.js';
import './economy.css';

// ---------------------------------------------------------------------------
// Composer state, kept in the table's memory so it survives an interrupt
// (an access request, a treaty offer) and comes back where it was.

interface Draft {
  /** which listed purchase is chosen: an item name, a tech, or a fixed key */
  pick: string | null;
  stage: 'choose' | 'pay' | 'place';
  /** the placements the person chose, in order; absent when the engine's
   *  proposal is being committed as listed (no live engine to ask) */
  payment?: Payment;
  /** a platform's Core, when the engine lists both ways: one from the reserve,
   *  or a new one bought with it. Never chosen for the person. */
  core?: CoreWay;
}

type CoreWay = 'reserve' | 'buy';

const KEY = 'ngg:purchase';

/** React state that writes through to the table's memory, so a screen that
 *  unmounts (an interrupt took over) comes back with the draft it had. */
function useDraft(ctx: ScreenCtx, scope: string): [Draft, (d: Draft) => void] {
  const memKey = `${KEY}:${scope}`;
  const [draft, setState] = useState<Draft>(() => (ctx.memory.get(memKey) as Draft | undefined) ?? { pick: null, stage: 'choose' });
  const set = (d: Draft) => { ctx.memory.set(memKey, d); setState(d); };
  return [draft, set];
}

// ---------------------------------------------------------------------------
// Purchases, as the engine lists them.

type Payment = Array<{ collectorId: string; coord: string }>;

interface Purchase {
  /** a stable key: the item, the tech, 'battle_card' or 'economic' */
  key: string;
  label: string;
  kind: 'unit' | 'building' | 'base' | 'tech' | 'battle_card' | 'economic';
  cost: Cost | null;
  text: string | null;
  /** every listed move for it; several when the engine lists one per place */
  moves: LegalMove[];
  /** the engine's reason it cannot be bought now; such a purchase has no moves */
  shut: string | null;
  /** a battle card's either-or leg, shown after its cost */
  either?: string[];
}

/** How a listed platform purchase gets its Core. */
function coreWayOf(m: LegalMove): CoreWay {
  return m.move['core_pairing'] === true ? 'buy' : 'reserve';
}

/** The Core ways the engine lists for a purchase; two means the person chooses. */
function coreWaysOf(p: Purchase): CoreWay[] {
  if (p.kind !== 'unit') return [];
  return [...new Set(p.moves.map(coreWayOf))];
}

function addCost(a: Cost | null, b: Cost | null): Cost | null {
  if (!a || !b) return a ?? b;
  const out: Cost = { ...a };
  for (const [k, n] of Object.entries(b)) out[k as keyof Cost] = (out[k as keyof Cost] ?? 0) + (n ?? 0);
  return out;
}

function paymentOf(m: LegalMove): Payment {
  const p = m.move['payment'];
  return Array.isArray(p) ? (p as Payment) : [];
}

function atBaseOf(m: LegalMove): string | null {
  const a = m.move['at_base'];
  return typeof a === 'string' && a !== '' ? a : null;
}

/** The move types a composer buys with: its blocked purchases show beside the open ones. */
type Buys = 'build' | 'research';

function purchasesOf(ctx: ScreenCtx, buys: Buys | null): Purchase[] {
  const out = new Map<string, Purchase>();
  for (const m of ctx.legal) {
    const t = moveType(m.move);
    if (t === 'build') {
      const name = String(m.move['item'] ?? '');
      const found = itemByName(ctx.ref, name);
      const kind: Purchase['kind'] = found?.kind === 'building' ? (found.building.isBase ? 'base' : 'building') : 'unit';
      const cost = found ? (found.kind === 'unit' ? found.unit.cost : found.building.cost) : null;
      const text = found ? (found.kind === 'unit' ? found.unit.notes : found.building.effect) : null;
      const p = out.get(name) ?? { key: name, label: name, kind, cost, text, moves: [], shut: null };
      p.moves.push(m);
      out.set(name, p);
    } else if (t === 'research' && m.move['kind'] === 'tech') {
      const name = String(m.move['tech'] ?? '');
      const r = researchByName(ctx.ref, name, ctx.mine?.species);
      out.set(name, { key: name, label: name, kind: 'tech', cost: r?.cost ?? null, either: r?.either, text: r?.effect ?? null, moves: [m], shut: null });
    } else if (t === 'research' && m.move['kind'] === 'battle_card') {
      out.set('battle_card', { key: 'battle_card', label: 'Draw a battle card', kind: 'battle_card', cost: ctx.ref?.battleCardPurchase?.cost ?? null, either: ctx.ref?.battleCardPurchase?.either, text: null, moves: [m], shut: null });
    } else if (t === 'economic_victory_spend') {
      out.set('economic', { key: 'economic', label: 'Economic victory: spend all five', kind: 'economic', cost: ctx.ref?.economicSpend ?? null, text: null, moves: [m], shut: null });
    }
  }
  // What cannot be bought now, struck through with the engine's reason, after
  // what can. Only the engine's own entries: nothing here is worked out.
  const shut: Purchase[] = [];
  for (const u of buys ? ctx.unavailable : []) {
    const reason = capitalize(ctx.say(u.reason));
    if (buys === 'build' && u.moveType === 'build' && u.item) {
      if (out.has(u.item)) continue;
      const found = itemByName(ctx.ref, u.item);
      const kind: Purchase['kind'] = found?.kind === 'building' ? (found.building.isBase ? 'base' : 'building') : 'unit';
      const cost = found ? (found.kind === 'unit' ? found.unit.cost : found.building.cost) : null;
      const text = found ? (found.kind === 'unit' ? found.unit.notes : found.building.effect) : null;
      shut.push({ key: `shut:${u.item}`, label: u.item, kind, cost, text, moves: [], shut: reason });
    } else if (buys === 'build' && u.moveType === 'economic_victory_spend') {
      if (out.has('economic')) continue;
      shut.push({ key: 'shut:economic', label: 'Economic victory: spend all five', kind: 'economic', cost: ctx.ref?.economicSpend ?? null, text: null, moves: [], shut: reason });
    } else if (buys === 'research' && u.moveType === 'research' && u.item) {
      if (u.item === 'battle strategy card') {
        if (out.has('battle_card')) continue;
        shut.push({ key: 'shut:battle_card', label: 'Draw a battle card', kind: 'battle_card', cost: ctx.ref?.battleCardPurchase?.cost ?? null, either: ctx.ref?.battleCardPurchase?.either, text: null, moves: [], shut: reason });
        continue;
      }
      if (out.has(u.item)) continue;
      const r = researchByName(ctx.ref, u.item, ctx.mine?.species);
      shut.push({ key: `shut:${u.item}`, label: u.item, kind: 'tech', cost: r?.cost ?? null, either: r?.either, text: r?.effect ?? null, moves: [], shut: reason });
    }
  }
  return [...out.values(), ...shut];
}

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** What a Core bought with its platform (core_pairing) adds to the price, as
 *  the engine says (nothing with Core Integration); the printed Core cost from
 *  an engine that does not say. */
function coreCost(ctx: ScreenCtx): Cost | null {
  if (ctx.mine?.pairedCoreCost) return ctx.mine.pairedCoreCost as Cost;
  return itemByName(ctx.ref, 'Core')?.kind === 'unit' ? (itemByName(ctx.ref, 'Core') as { unit: { cost: Cost } }).unit.cost : null;
}

/** What a collector is called and drawn as: a wizard's Surf takes any
 *  resource; a robot's collector is typed, and it stands on its own resource. */
function collectorIcon(ctx: ScreenCtx, ownerId: string | null, coord: string): string {
  const species = ctx.v.players.find((p) => p.id === ownerId)?.species;
  if (species === 'wizard') return 'Surf';
  const res = ctx.v.tiles.find((t) => t.coord === coord)?.resource;
  return res && TERRAIN[res] ? `${TERRAIN[res]!.name} collector` : 'Collector';
}

function proposalsOf(ctx: ScreenCtx, payment: Payment): MapProposal[] {
  return payment.map((p) => ({
    coord: p.coord, owner: ctx.me ?? '', kind: 'collector', key: `pay:${p.collectorId}`, pieceId: p.collectorId,
    name: collectorIcon(ctx, ctx.me, p.coord),
  }));
}

// ---------------------------------------------------------------------------
// The composer.

const KIND_WORDS: Record<Purchase['kind'], string> = {
  unit: 'Unit', building: 'Building', base: 'Base', tech: 'Technology', battle_card: 'Battle card', economic: 'Victory',
};

function PurchaseRow({ ctx, p, selected, onPick }: { ctx: ScreenCtx; p: Purchase; selected: boolean; onPick: () => void }) {
  const ways = coreWaysOf(p);
  const pairing = ways.length === 1 && ways[0] === 'buy';
  const core = pairing ? coreCost(ctx) : null;
  return (
    <OptionRow
      selected={selected}
      disabled={!ctx.live}
      shutReason={p.shut}
      onPress={p.shut ? undefined : onPick}
      mark={<Icon name={p.kind === 'battle_card' ? 'Battle card' : p.kind === 'economic' ? 'Build' : p.label} size={20} stroke={1.8} />}
      title={p.label}
      sub={p.text ? <span className="ngg-eco-text">{p.text}</span> : undefined}
      aside={
        <span className="ngg-eco-cost">
          <span className="ngg-eco-kind">{KIND_WORDS[p.kind]}</span>
          {p.cost && !p.either?.length && <CostChips cost={p.cost} />}
          {core && (Object.keys(core).length > 0
            ? <span className="ngg-eco-core">+ Core <CostChips cost={core} /></span>
            : <span className="ngg-eco-core">+ Core, free</span>)}
          {ways.length > 1 && <span className="ngg-eco-core">Core: yours or bought</span>}
        </span>
      }
    >
      {/* A long "+ either" price sits under the name, so the text keeps its width. */}
      {p.cost && p.either?.length ? <span className="ngg-eco-price"><BattleCardPrice cost={p.cost} either={p.either} /></span> : null}
    </OptionRow>
  );
}

function PaymentList({ ctx, payment }: { ctx: ScreenCtx; payment: Payment }) {
  return (
    <ul className="ngg-eco-pay">
      {payment.map((p) => {
        const tile = ctx.v.tiles.find((t) => t.coord === p.coord);
        const owner = tile?.baseOwner && tile.baseOwner !== ctx.me ? tile.baseOwner : null;
        return (
          <li key={p.collectorId}>
            <span className="ngg-eco-pay-mark"><Icon name={collectorIcon(ctx, ctx.me, p.coord)} size={16} stroke={2} /></span>
            <b>{ctx.tile(p.coord)}</b>
            <ResourceChip resource={tile?.resource ?? null} />
            {owner && <span className="ngg-eco-owner">{ctx.seat(owner)}’s base</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Composer({ ctx, scope, buys, title, kicker, skip, skipLabel, children }: {
  ctx: ScreenCtx;
  scope: string;
  /** which purchases this composer makes, for the blocked ones beside them */
  buys: Buys | null;
  title: string;
  kicker?: string;
  /** the listed move that declines (skip_action) */
  skip: LegalMove | null;
  skipLabel: string;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useDraft(ctx, scope);
  const purchases = useMemo(() => purchasesOf(ctx, buys), [ctx, buys]);
  const open = purchases.filter((p) => !p.shut);
  // A pick the engine no longer lists (after a refusal, a new event) is gone.
  const picked = draft.pick ? open.find((p) => p.key === draft.pick) ?? null : null;
  // A platform the engine lists both ways asks which Core before anything else.
  const ways = picked ? coreWaysOf(picked) : [];
  const coreAsk = ways.length > 1;
  const way = coreAsk && draft.core && ways.includes(draft.core) ? draft.core : null;
  const chosen: Purchase | null = !picked ? null
    : !coreAsk ? picked
    : way ? { ...picked, moves: picked.moves.filter((m) => coreWayOf(m) === way), cost: way === 'buy' ? addCost(picked.cost, coreCost(ctx)) : picked.cost }
    : null;
  const stage = chosen ? draft.stage : 'choose';
  const first = chosen?.moves[0] ?? null;
  const payment = first ? paymentOf(first) : [];
  const places = chosen ? [...new Set(chosen.moves.map(atBaseOf).filter((x): x is string => x !== null))] : [];
  const needsPlace = places.length > 0;

  const back = () => setDraft({ pick: null, stage: 'choose' });
  /** Send a listed move: as listed, or with the payment the person chose —
   *  the listed template with only its payment changed. */
  const sendWith = (m: LegalMove, chosenPayment: Payment | undefined) => {
    if (chosenPayment) ctx.sendForm(m, { ...m.move, payment: chosenPayment }, ['payment']);
    else ctx.send(m);
  };
  const commitPayment = (chosenPayment?: Payment) => {
    if (!chosen || !first) return;
    if (needsPlace) { setDraft({ pick: chosen.key, stage: 'place', payment: chosenPayment, core: draft.core }); return; }
    sendWith(first, chosenPayment);
  };
  const place = (coord: string) => {
    const m = chosen?.moves.find((x) => atBaseOf(x) === coord);
    if (m) sendWith(m, draft.payment);
  };

  if (stage === 'choose' || !chosen) {
    return (
      <TableLayout
        ctx={ctx}
        panel={<>
          <Panel title={title} kicker={kicker}>
            {children}
            {purchases.length > 0
              ? <div className="ngg-options">{purchases.map((p) => (
                  <Fragment key={p.key}>
                    <PurchaseRow ctx={ctx} p={p} selected={draft.pick === p.key}
                      onPick={() => setDraft({ pick: p.key, stage: 'choose' })} />
                    {/* The Core question sits under the platform it is for. */}
                    {picked && coreAsk && picked.key === p.key && (
                      <div className="ngg-eco-coreway" role="group" aria-label={`Which Core goes in the ${picked.label}?`}>
                        <HowTo>Which Core goes in the {picked.label}?</HowTo>
                        <div className="ngg-options">
                          <OptionRow selected={way === 'reserve'} disabled={!ctx.live}
                            onPress={() => setDraft({ pick: picked.key, stage: 'choose', core: 'reserve' })}
                            mark={<Icon name="Core" size={20} stroke={1.8} />}
                            title="A Core from your reserve"
                            sub={`${ctx.mine?.coresReserve ?? 0} in reserve · each one there earns +1 culture a round`} />
                          <OptionRow selected={way === 'buy'} disabled={!ctx.live}
                            onPress={() => setDraft({ pick: picked.key, stage: 'choose', core: 'buy' })}
                            mark={<Icon name="Core" size={20} stroke={1.8} />}
                            title="Buy a new Core with it"
                            sub="One purchase: the platform and its Core together"
                            aside={coreCost(ctx) ? <span className="ngg-eco-cost"><CostChips cost={coreCost(ctx)!} /></span> : undefined} />
                        </div>
                      </div>
                    )}
                  </Fragment>
                ))}</div>
              : <HowTo>The engine lists nothing to buy this action.</HowTo>}
            {purchases.length > 0 && open.length === 0 && <HowTo>Nothing can be bought this action; each line says why.</HowTo>}
            <Actions>
              {skip && <Btn kind="secondary" disabled={!ctx.live} onClick={() => ctx.send(skip)}>{skipLabel}</Btn>}
              <Btn disabled={!ctx.live || !picked || (coreAsk && !way)} onClick={() => picked && setDraft({ pick: picked.key, stage: 'pay', core: draft.core })}>
                {draft.pick ? `Choose ${purchases.find((p) => p.key === draft.pick)?.label ?? ''}` : 'Choose'}
              </Btn>
            </Actions>
          </Panel>
          {/* A treaty may be offered while your own action resolves; the panel
              draws only when the engine lists an offer. */}
          <DiplomacyPanel ctx={ctx} />
        </>}
      />
    );
  }

  if (stage === 'pay' && ctx.ask) {
    return (
      <PayStage ctx={ctx} chosen={chosen} purchase={first?.move ?? {}} proposal={payment} needsPlace={needsPlace}
        initial={draft.payment ?? []} onBack={back} onCommit={(pay) => commitPayment(pay)} />
    );
  }

  if (stage === 'pay') {
    return (
      <TableLayout
        ctx={ctx}
        marks={{
          proposals: proposalsOf(ctx, payment),
          tags: new Map(payment.map((p) => [p.coord, 'PAY'])),
        }}
        panel={
          <Panel title={chosen.kind === 'economic' ? 'Spend all five' : `Pay for ${chosen.label}`} kicker={KIND_WORDS[chosen.kind]}>
            {chosen.cost && <div className="ngg-eco-costline"><span>Cost</span><CostChips cost={chosen.cost} /></div>}
            <HowTo>{payment.length === 0 ? 'Nothing to place: this one is free.' : `The engine proposes ${payment.length === 1 ? 'this placement' : `these ${payment.length} placements`}. Dashed means not on the board yet.`}</HowTo>
            <PaymentList ctx={ctx} payment={payment} />
            <Rule>Nothing is spent until you commit. Collectors stay on the map until upkeep.</Rule>
            {chosen.kind === 'economic' && ctx.mine && (
              <Rule>{ctx.mine.leaderAlive ? 'Your Leader is alive.' : 'Your Leader is dead: this spend cannot win.'}</Rule>
            )}
            <Actions>
              <Btn kind="secondary" onClick={back}>Drop the purchase</Btn>
              <Btn disabled={!ctx.live} onClick={() => commitPayment()}>{needsPlace ? 'Commit payment, then place it' : chosen.kind === 'economic' ? `Commit all ${economicCollectorsFor(ctx.ref, ctx.v.layout) ?? ''}`.trim() : 'Commit payment'}</Btn>
            </Actions>
          </Panel>
        }
      />
    );
  }

  // Place It: the piece is in hand; the lit hexes are the places the engine listed.
  return (
    <TableLayout
      ctx={ctx}
      marks={{
        lit: new Set(places),
        greyRest: true,
        proposals: proposalsOf(ctx, draft.payment ?? payment),
        tags: new Map(places.map((c) => [c, chosen.kind === 'base' ? 'NEW BASE' : 'BASE'])),
        onTile: ctx.live ? place : undefined,
      }}
      panel={
        <Panel title={`${chosen.label} is in hand`} kicker={chosen.kind === 'base' ? 'A new base' : 'Spawns at a base'}>
          <HowTo>Click a lit hex to place it{places.length > 1 ? ` — ${places.length} are open` : ''}.</HowTo>
          <div className="ngg-options">
            {places.map((c) => (
              <OptionRow key={c} disabled={!ctx.live} onPress={() => place(c)} title={ctx.tile(c)}
                sub={chosen.kind === 'base' ? 'New base here' : 'Your base · place it here'}
                aside={<ResourceChip resource={ctx.v.tiles.find((t) => t.coord === c)?.resource ?? null} />} />
            ))}
          </div>
          <Rule>Nothing is spent until the hex is clicked.</Rule>
          <Actions>
            <Btn kind="secondary" onClick={() => setDraft({ pick: chosen.key, stage: 'pay', payment: draft.payment })}>Put it back</Btn>
          </Actions>
        </Panel>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Paying: the person places each collector, one at a time, on a tile the
// engine names. The chain rule (each placement makes its neighbours reachable)
// stays in the engine: after every placement the screen asks where the
// collectors still in hand may go next (Game.queryChoice "collector_reach").

interface Reach {
  collectors: Array<{ id: string; resource: string | null; placed_at: string | null }>;
  next: Record<string, string[]>;
  produced: Record<string, number>;
  access_needed: Array<{ collectorId: string; coord: string; owner: string }>;
  /** a Haste wizard's bank (#101), which pays before the placements */
  bank: Record<string, number>;
  /** the engine's word on whether the placements pay for the purchase; absent from an engine that does not say */
  covers?: boolean;
  short?: Record<string, number>;
  short_either?: string[] | null;
}

function readReach(x: unknown): Reach | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (!Array.isArray(o['collectors']) || !o['next'] || typeof o['next'] !== 'object') return null;
  return {
    collectors: o['collectors'] as Reach['collectors'],
    next: o['next'] as Reach['next'],
    produced: (o['produced'] ?? {}) as Reach['produced'],
    access_needed: (Array.isArray(o['access_needed']) ? o['access_needed'] : []) as Reach['access_needed'],
    bank: o['bank'] && typeof o['bank'] === 'object' ? Object.fromEntries(Object.entries(o['bank'] as Record<string, unknown>).filter(([, n]) => typeof n === 'number' && n > 0)) as Record<string, number> : {},
    ...(typeof o['covers'] === 'boolean' ? { covers: o['covers'] } : {}),
    short: (o['short'] ?? {}) as Record<string, number>,
    short_either: Array.isArray(o['short_either']) ? o['short_either'] as string[] : null,
  };
}

function PayStage({ ctx, chosen, purchase, proposal, needsPlace, initial, onBack, onCommit }: {
  ctx: ScreenCtx;
  chosen: Purchase;
  /** the listed move being paid for, so the engine can say whether the placements cover it */
  purchase: Record<string, unknown>;
  /** the engine's own proposed payment, offered as one press, never pre-chosen */
  proposal: Payment;
  needsPlace: boolean;
  initial: Payment;
  onBack: () => void;
  onCommit: (payment: Payment) => void;
}) {
  const [placed, setPlaced] = useState<Payment>(initial);
  const [holding, setHolding] = useState<string | null>(null);
  const [reach, setReach] = useState<Reach | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const key = JSON.stringify(placed);
  const ask = ctx.ask;

  useEffect(() => {
    if (!ask) return;
    let stop = false;
    setReach(null);
    void ask('collector_reach', { prior: placed, purchase }).then((r) => {
      if (stop) return;
      if ('answer' in r) { setReach(readReach(r.answer)); setRefused(null); } else { setRefused(r.refused); }
    });
    return () => { stop = true; };
    // The question is the placements so far; a new round or stack is a new purchase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ctx.v.round, ctx.v.stack.length]);

  const inHand = reach ? reach.collectors.filter((c) => c.placed_at === null) : [];
  // A wizard's Surfs are all alike: one kind in hand. A robot's collectors are
  // typed: one kind per resource.
  const kinds = new Map<string, string[]>();
  for (const c of inHand) {
    const k = c.resource ?? 'surf';
    kinds.set(k, [...(kinds.get(k) ?? []), c.id]);
  }
  const holdingId = holding && inHand.some((c) => c.id === holding) ? holding : null;
  const lit = new Set(holdingId && reach ? reach.next[holdingId] ?? [] : []);
  const put = (coord: string) => {
    if (!holdingId) return;
    setPlaced([...placed, { collectorId: holdingId, coord }]);
    // Another alike collector stays in hand; a different type is taken again.
    const kind = inHand.find((c) => c.id === holdingId)?.resource ?? 'surf';
    const same = (kinds.get(kind) ?? []).filter((id) => id !== holdingId);
    setHolding(same[0] ?? null);
  };
  const removeFrom = (i: number) => { setPlaced(placed.slice(0, i)); setHolding(null); };
  const nameFor = (resource: string | null) => (resource ? `${TERRAIN[resource]?.name ?? resource} collector` : 'Surf');
  const owners = new Map((reach?.access_needed ?? []).map((a) => [a.collectorId, a.owner]));

  return (
    <TableLayout
      ctx={ctx}
      marks={{
        lit,
        greyRest: lit.size > 0,
        proposals: placed.map((p): MapProposal => ({
          coord: p.coord, owner: ctx.me ?? '', kind: 'collector', key: `pay:${p.collectorId}`, pieceId: p.collectorId,
          name: collectorIcon(ctx, ctx.me, p.coord),
        })),
        tags: new Map(placed.map((p) => [p.coord, owners.has(p.collectorId) ? 'ASK' : 'PAY'])),
        onTile: ctx.live ? put : undefined,
      }}
      panel={
        <Panel title={chosen.kind === 'economic' ? 'Spend all five' : `Pay for ${chosen.label}`} kicker={KIND_WORDS[chosen.kind]}>
          {chosen.cost && <div className="ngg-eco-costline"><span>Cost</span><CostChips cost={chosen.cost} /></div>}
          {reach && Object.keys(reach.bank).length > 0 && (
            <div className="ngg-eco-costline" title="What Haste banked earlier this round; it pays first"><span>From your bank</span><CostChips cost={reach.bank as Cost} /></div>
          )}
          <div className="ngg-eco-costline"><span>Produces</span>
            {reach && Object.keys(reach.produced).length > 0 ? <CostChips cost={reach.produced as Cost} /> : <span className="ngg-cost-free">nothing yet</span>}
          </div>
          {reach && reach.covers === false && (
            <div className="ngg-eco-costline"><span>Still needs</span>
              {Object.keys(reach.short ?? {}).length > 0 && <CostChips cost={reach.short as Cost} />}
              {reach.short_either && <span className="ngg-cost-free">and one {reach.short_either.join(' or ')}</span>}
            </div>
          )}
          {refused && <p className="ngg-option-reason">{ctx.say(refused)}</p>}
          <HowTo>{holdingId ? 'Click a lit hex to place it.' : 'Take a collector from your hand, then click a lit hex.'}</HowTo>
          {kinds.size > 0 && (
            <div className="ngg-eco-hand">
              {[...kinds.entries()].map(([k, ids]) => {
                const res = k === 'surf' ? null : k;
                const held = holdingId !== null && ids.includes(holdingId);
                const reachable = (reach?.next[ids[0]!] ?? []).length > 0;
                return (
                  <button key={k} type="button" className={`ngg-eco-take${held ? ' held' : ''}`} disabled={!ctx.live || !reachable}
                    onClick={() => setHolding(held ? null : ids[0]!)} aria-pressed={held}>
                    <Icon name={res ? `${TERRAIN[res]?.name ?? ''} collector` : 'Surf'} size={16} stroke={2} />
                    {nameFor(res)}{ids.length > 1 ? ` ×${ids.length}` : ''}
                  </button>
                );
              })}
            </div>
          )}
          {placed.length > 0 && (
            <ul className="ngg-eco-pay">
              {placed.map((p, i) => {
                const tile = ctx.v.tiles.find((t) => t.coord === p.coord);
                const owner = owners.get(p.collectorId);
                return (
                  <li key={p.collectorId} className={owner ? 'asked' : ''}>
                    <span className="ngg-eco-pay-mark"><Icon name={collectorIcon(ctx, ctx.me, p.coord)} size={16} stroke={2} /></span>
                    <b>{ctx.tile(p.coord)}</b>
                    <ResourceChip resource={tile?.resource ?? null} />
                    {owner && <span className="ngg-eco-owner">{ctx.seat(owner)} has to agree</span>}
                    <button type="button" className="ngg-eco-remove" onClick={() => removeFrom(i)} disabled={!ctx.live}
                      aria-label={`Take back ${ctx.tile(p.coord)}`}
                      title={i < placed.length - 1 ? 'Take this back, and the ones placed after it' : 'Take this back'}>✕</button>
                  </li>
                );
              })}
            </ul>
          )}
          <Rule>Nothing is spent until you commit. Collectors stay on the map until upkeep.</Rule>
          {chosen.kind === 'economic' && ctx.mine && (
            <Rule>{ctx.mine.leaderAlive ? 'Your Leader is alive.' : 'Your Leader is dead: this spend cannot win.'}</Rule>
          )}
          <Actions>
            <Btn kind="secondary" onClick={onBack}>Drop the purchase</Btn>
            {proposal.length > 0 && placed.length === 0 && (
              <Btn kind="quiet" disabled={!ctx.live} onClick={() => { setPlaced(proposal); setHolding(null); }}>Choose for me</Btn>
            )}
            <Btn disabled={!ctx.live || !reach || reach.covers === false || (reach.covers === undefined && placed.length === 0 && proposal.length > 0)} onClick={() => onCommit(placed)}>
              {needsPlace ? 'Commit payment, then place it' : chosen.kind === 'economic' ? `Commit all ${economicCollectorsFor(ctx.ref, ctx.v.layout) ?? ''}`.trim() : 'Commit payment'}
            </Btn>
          </Actions>
        </Panel>
      }
    />
  );
}

/** One action card's identity within the game: the round and how many cards
 *  are still on the stack. A second Build in the same round is a new action,
 *  so it starts with nothing chosen rather than the last Build's pick. */
function actionKey(ctx: ScreenCtx): string {
  return `${ctx.v.round}:${ctx.v.stack.length}`;
}

function skipOf(ctx: ScreenCtx): LegalMove | null {
  return ctx.movesOf('skip_action')[0] ?? null;
}

function BuildScreen({ ctx }: { ctx: ScreenCtx }) {
  if (ctx.route.perspective !== 'decide') return <TableLayout ctx={ctx} />;
  return (
    <Composer ctx={ctx} scope={`build:${actionKey(ctx)}`} buys="build" title="Buy one thing" kicker="Your Build card is resolving"
      skip={skipOf(ctx)} skipLabel="Skip this action">
      <Rule>One unit, building or base per Build action.</Rule>
    </Composer>
  );
}

function ResearchScreen({ ctx }: { ctx: ScreenCtx }) {
  if (ctx.route.perspective !== 'decide') return <TableLayout ctx={ctx} />;
  return (
    <Composer ctx={ctx} scope={`research:${actionKey(ctx)}`} buys="research" title="Unlock one technology, or draw a card" kicker="Your Research card is resolving"
      skip={skipOf(ctx)} skipLabel="Skip this action">
      <Rule>One purchase per Research action.</Rule>
      <div className="ngg-eco-deck"><Icon name="Battle card" size={16} stroke={1.8} />{ctx.v.deckCount} battle cards in the deck · {ctx.v.hand.length} in your hand</div>
    </Composer>
  );
}

function SecondPurchaseScreen({ ctx }: { ctx: ScreenCtx }) {
  if (ctx.route.perspective !== 'decide') return <TableLayout ctx={ctx} />;
  const committed = ctx.mine?.collectors ?? [];
  return (
    <Composer ctx={ctx} scope={`second:${actionKey(ctx)}`} buys={ctx.v.activeAction?.cardKind === 'research' ? 'research' : ctx.v.activeAction?.cardKind === 'build' ? 'build' : null} title="A second purchase" kicker="One action, two purchases"
      skip={skipOf(ctx)} skipLabel="Stop at one">
      <Rule>Separate collectors pay for each. The second falling through never undoes the first.</Rule>
      {committed.length > 0 && (
        <div className="ngg-eco-down">
          <span className="ngg-kicker">Already down</span>
          {committed.map((c) => <span key={c.id}>{ctx.tile(c.coord)} <ResourceChip resource={c.resource} /></span>)}
        </div>
      )}
    </Composer>
  );
}

function SmythScreen({ ctx }: { ctx: ScreenCtx }) {
  const smyth = heroById(ctx.ref, 'smyth');
  const techs = ctx.movesOf('research');
  const panel = ctx.route.perspective !== 'decide' ? undefined : (
    <Panel title="Take one unresearched technology" kicker={smyth?.name ?? "Smyth's reward"}>
      {smyth && <Rule>{smyth.effect}</Rule>}
      <div className="ngg-options">
        {techs.map((m, i) => {
          const name = String(m.move['tech'] ?? '');
          const r = researchByName(ctx.ref, name, ctx.mine?.species);
          return (
            <OptionRow key={i} disabled={!ctx.live} onPress={() => ctx.send(m)}
              mark={<Icon name={name} size={20} stroke={1.8} />}
              title={`Take ${name}`} sub={r?.effect}
              aside={<span className="ngg-eco-free">FREE HERE</span>} />
          );
        })}
      </div>
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Access Request: somebody wants your tile. An interrupt on the owner's seat;
// the buyer sees the same terms and waits.

interface AccessContext {
  buyer: string;
  action: string;
  item: string;
  thisRequest: { collector: string; tile: string };
  placements: Array<{ collector: string; tile: string; resource: string | null; locationOwner: string | null }>;
  queue: { index: number; total: number } | null;
}

function readAccess(ctx: ScreenCtx): AccessContext | null {
  const c = ctx.v.pending?.context;
  if (!c || typeof c['buyer'] !== 'string') return null;
  const tr = (c['this_request'] ?? {}) as Record<string, unknown>;
  const q = c['queue'] as Record<string, unknown> | null | undefined;
  return {
    buyer: c['buyer'] as string,
    action: String(c['action'] ?? ''),
    item: String(c['item'] ?? ''),
    thisRequest: { collector: String(tr['collector'] ?? ''), tile: String(tr['tile'] ?? '') },
    placements: (Array.isArray(c['placements']) ? c['placements'] : []).map((p: Record<string, unknown>) => ({
      collector: String(p['collector'] ?? ''),
      tile: String(p['tile'] ?? ''),
      resource: typeof p['resource'] === 'string' ? p['resource'] : null,
      locationOwner: typeof p['location_owner'] === 'string' ? p['location_owner'] : null,
    })),
    queue: q && typeof q['index'] === 'number' && typeof q['total'] === 'number' ? { index: q['index'] as number, total: q['total'] as number } : null,
  };
}

function AccessRequestScreen({ ctx }: { ctx: ScreenCtx }) {
  const a = readAccess(ctx);
  const coordOf = (label: string) => ctx.v.tiles.find((t) => t.label === label)?.coord ?? null;
  const asked = a ? coordOf(a.thisRequest.tile) : null;
  const marks = a ? {
    selected: asked,
    greyRest: true,
    lit: new Set<string>(),
    origin: asked,
    proposals: a.placements.map((p): MapProposal => ({
      coord: coordOf(p.tile) ?? '', owner: a.buyer, kind: 'collector', key: `acc:${p.collector}`, pieceId: p.collector,
      name: collectorIcon(ctx, a.buyer, coordOf(p.tile) ?? ''),
    })).filter((p) => p.coord),
  } : undefined;
  const found = a ? itemByName(ctx.ref, a.item) : null;
  const cost = found ? (found.kind === 'unit' ? found.unit.cost : found.building.cost) : null;
  const grant = ctx.movesOf('respond_access_request').find((m) => m.move['grant'] === true) ?? null;
  const refuse = ctx.movesOf('respond_access_request').find((m) => m.move['grant'] === false) ?? null;
  const buyerLeader = a ? ctx.v.players.find((p) => p.id === a.buyer)?.leaderAlive : false;

  const terms = a && (
    <>
      {a.queue && a.queue.total > 1 && <div className="ngg-kicker">Request {a.queue.index} of {a.queue.total}</div>}
      <div className="ngg-eco-terms">
        <span><i>WHICH COLLECTOR</i><b><Icon name={collectorIcon(ctx, a.buyer, asked ?? '')} size={15} stroke={2} />{collectorIcon(ctx, a.buyer, asked ?? '')}</b></span>
        <span><i>WHICH TILE</i><b>{a.thisRequest.tile}</b></span>
        <span><i>WHAT FOR</i><b>{a.item}</b>{cost && <CostChips cost={cost} />}</span>
      </div>
      <div className="ngg-kicker">Their placements</div>
      <ul className="ngg-eco-pay">
        {a.placements.map((p) => (
          <li key={p.collector} className={p.tile === a.thisRequest.tile ? 'asked' : ''}>
            <b>{p.tile}</b><ResourceChip resource={p.resource} />
            {p.locationOwner && <span className="ngg-eco-owner">{p.locationOwner === ctx.me ? 'yours' : ctx.seat(p.locationOwner)}</span>}
          </li>
        ))}
      </ul>
      {a.item === 'Economic victory spend' && buyerLeader && (
        <Rule>If this payment completes, {ctx.seat(a.buyer)} wins an economic victory.</Rule>
      )}
    </>
  );

  if (ctx.route.interrupt && a) {
    return (
      <TableLayout
        ctx={ctx}
        marks={marks}
        interrupt={
          <Panel tone="urgent" kicker="Not your turn — your answer" title={`${ctx.seat(a.buyer)} asks to stand one collector on ${a.thisRequest.tile}`}>
            <SeatBand faction={ctx.v.players.find((p) => p.id === a.buyer)?.faction ?? null} name={ctx.seat(a.buyer)}>
              <span className="ngr-proposer-treaty">Asks for {a.thisRequest.tile}</span>
            </SeatBand>
            {terms}
            {grant && <Rule>{grant.description}</Rule>}
            {refuse && <Rule>{refuse.description}</Rule>}
            <Actions>
              {refuse && <Btn kind="secondary" disabled={!ctx.live} onClick={() => ctx.send(refuse)}>Refuse</Btn>}
              {grant && <Btn disabled={!ctx.live} onClick={() => ctx.send(grant)}>Allow</Btn>}
            </Actions>
          </Panel>
        }
      />
    );
  }
  // The buyer (and only the buyer) sees the terms while the owner decides.
  const panel = a ? (
    <Panel kicker={a.queue && a.queue.total > 1 ? `Request ${a.queue.index} of ${a.queue.total}` : 'Waiting for consent'} title={`${ctx.seat(ctx.v.pending?.for)} has to agree`}>
      {terms}
    </Panel>
  ) : undefined;
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

export const ECONOMY_SCREENS: Partial<Record<ScreenKey, ComponentType<{ ctx: ScreenCtx }>>> = {
  build: BuildScreen,
  research: ResearchScreen,
  'second-purchase': SecondPurchaseScreen,
  'smyth-reward': SmythScreen,
  'access-request': AccessRequestScreen,
};
