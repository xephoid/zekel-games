// NGnG screens: battle. See docs/design/SCREEN-ROUTING.md for the routes.
//
// Every option on these screens is the engine's: a pending's own options
// (shut ones struck through with the engine's reason), or the seat's listed
// moves. Picks that take more than one press (an origin then a destination,
// an action then a target, a card then Commit) live in ctx.memory under a
// stamp for the decision they belong to, and are checked against the listed
// moves on every render, so a pick from an older state is never trusted.

import { useState, type ComponentType, type ReactNode } from 'react';
import type { LegalMove } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import { movesEqual } from '@zekel/glue-kit';
import type { ScreenCtx } from '../ctx.js';
import type { ScreenKey } from '../route.js';
import type { NggBattleUnit, NggOption } from '../read.js';
import type { MapMarks } from '../HexMap.js';
import { TableLayout } from '../Layout.js';
import { TERRAIN } from '../factions.js';
import { cardByLabel, heroById, researchByName, treatyByName } from '../ref.js';
import { Actions, Btn, CardFace, FactionChip, HowTo, OptionRow, Panel, Rule } from '../ui.js';
import { DiplomacyPanel } from './round.js';
import './battle.css';

type Screen = ComponentType<{ ctx: ScreenCtx }>;

// ---------------------------------------------------------------------------
// Small readers. None of them decides anything; they look things up.
// ---------------------------------------------------------------------------

/** The listed move equal to `move`, or undefined when the engine did not list it. */
function listed(ctx: ScreenCtx, move: Record<string, unknown> | null | undefined): LegalMove | undefined {
  return move ? ctx.legal.find((m) => movesEqual(m.move, move)) : undefined;
}

/** A pick kept across events, re-rendering on change. */
function useStash<T>(ctx: ScreenCtx, key: string): [T | undefined, (t: T | undefined) => void] {
  const [, bump] = useState(0);
  const val = ctx.memory.get(key) as T | undefined;
  const set = (t: T | undefined) => {
    if (t === undefined) ctx.memory.delete(key);
    else ctx.memory.set(key, t);
    bump((n) => n + 1);
  };
  return [val, set];
}

function statLine(init: number | null, dmg: number | null, def: number | null): string | null {
  if (init === null && dmg === null && def === null) return null;
  return `INIT ${init ?? '—'} · DMG ${dmg ?? '—'} · DEF ${def ?? '—'}`;
}

function battleUnit(ctx: ScreenCtx, ref: string | null | undefined): NggBattleUnit | null {
  return ref ? ctx.v.battle?.units.find((u) => u.ref === ref) ?? null : null;
}

/** A piece a move names by id: its printed name, its stat line, where it stands. */
function piece(ctx: ScreenCtx, id: string): { name: string; stats: string | null; coord: string | null; owner: string | null } {
  const b = battleUnit(ctx, id);
  if (b) return { name: b.label, stats: statLine(b.init, b.dmg, b.def), coord: ctx.v.battle?.coord ?? null, owner: b.owner };
  for (const p of ctx.v.players) {
    const u = p.units.find((x) => x.id === id);
    if (u) {
      const r = ctx.ref?.units.find((x) => x.name === u.type) ?? null;
      return { name: u.type, stats: r ? statLine(r.init, r.dmg, r.def) : null, coord: u.coord, owner: p.id };
    }
  }
  const h = heroById(ctx.ref, id);
  if (h) {
    for (const p of ctx.v.players) {
      const mine = p.heroes.find((x) => x.name === h.name && !x.dead);
      if (mine) return { name: h.name, stats: mine.stats, coord: mine.coord, owner: p.id };
    }
    return { name: h.name, stats: null, coord: null, owner: null };
  }
  return { name: id, stats: null, coord: null, owner: null };
}

function factionOf(ctx: ScreenCtx, pid: string | null | undefined): string | null {
  return pid ? ctx.v.players.find((p) => p.id === pid)?.faction ?? null : null;
}

function resourceName(ctx: ScreenCtx, coord: string): string | null {
  const t = ctx.v.tiles.find((x) => x.coord === coord);
  return t?.resource ? TERRAIN[t.resource]?.name ?? null : null;
}

/** The seats with pieces on a tile, other than mine. State, not a verdict. */
function othersOn(ctx: ScreenCtx, coord: string): string[] {
  const t = ctx.v.tiles.find((x) => x.coord === coord);
  const owners = new Set<string>();
  for (const p of t?.pieces ?? []) if (p.owner !== ctx.me) owners.add(p.owner);
  if (t?.baseOwner && t.baseOwner !== ctx.me) owners.add(t.baseOwner);
  return [...owners];
}

function battleKicker(ctx: ScreenCtx, withPass = false): string {
  const b = ctx.v.battle;
  if (!b) return `Round ${ctx.v.round}`;
  return `Battle at ${ctx.tile(b.coord)}${withPass ? ` · pass ${b.pass}` : ''}`;
}

/** The fight on the map: the contested tile and where the attack came from. */
function battleMarks(ctx: ScreenCtx, extra: MapMarks = {}): MapMarks {
  const b = ctx.v.battle;
  if (!b) return extra;
  const tags = new Map<string, string>(extra.tags ?? []);
  tags.set(b.coord, 'BATTLE');
  if (b.origin) tags.set(b.origin, 'FROM');
  return { contested: b.coord, origin: b.origin, ...extra, tags };
}

function Mana({ ctx }: { ctx: ScreenCtx }) {
  const m = ctx.mine;
  if (!m || m.species !== 'wizard') return null;
  return <span className="ngb-mana"><i>MANA</i> <b>{m.manaCurrent}</b> / {m.manaMax}</span>;
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="ngb-steps">
      {items.map((t, i) => <li key={i}><span className="ngb-num">{i + 1}</span><span>{t}</span></li>)}
    </ol>
  );
}

/** Stable ids for cards, so a card that moves between hand, table and
 *  discard is the same element to the table's FLIP root. */
function cardFlipIds(cards: Array<{ owner: string; label: string }>): string[] {
  const seen = new Map<string, number>();
  return cards.map((c) => {
    const k = `${c.owner}:${c.label}`;
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return `ngg-bcard:${k}:${n}`;
  });
}

// ---------------------------------------------------------------------------
// Pieces of the battle every battle screen shows.
// ---------------------------------------------------------------------------

const SIDE_NAMES: Record<string, string> = { attackers: 'ATTACKING', defenders: 'DEFENDING' };

function Armies({ ctx, acting }: { ctx: ScreenCtx; acting?: string | null }) {
  const b = ctx.v.battle;
  if (!b || b.units.length === 0) return null;
  const sides = [...new Set(b.units.map((u) => u.side))];
  return (
    <div className="ngg-armies">
      {sides.map((side) => (
        <div key={side} className="ngg-army">
          <span className="ngg-army-head">{SIDE_NAMES[side] ?? side.toUpperCase()}</span>
          {b.units.filter((u) => u.side === side).map((u) => (
            <div key={u.ref ?? u.label} className={`ngg-unit-row${u.activated ? ' acted' : ''}${acting && u.ref === acting ? ' acting' : ''}`} data-flip-id={`ngg-bunit:${u.ref ?? u.label}`} title={ctx.seat(u.owner)}>
              <FactionChip faction={factionOf(ctx, u.owner)} size={16} />
              <span className="ngg-unit-name">{u.label}</span>
              <span className="ngg-unit-stats">{u.init}·{u.dmg}·{u.def}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Committers({ ctx }: { ctx: ScreenCtx }) {
  const b = ctx.v.battle;
  if (!b || b.commitments.revealed) return null;
  const rows = Object.entries(b.commitments.bySeat);
  if (rows.length === 0) return null;
  return (
    <div className="ngb-block">
      <span className="ngg-kicker">Who has committed</span>
      <ul className="ngb-seatstates">
        {rows.map(([pid, st]) => (
          <li key={pid} className={st === 'committed' ? 'done' : ''}>
            <FactionChip faction={factionOf(ctx, pid)} size={16} />
            <span>{st === 'committed' ? `${ctx.seat(pid)} has committed` : pid === ctx.me ? 'Waiting on you' : `Waiting on ${ctx.seat(pid)}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The revealed commitments, face up, each with its state from the view. */
function Revealed({ ctx, highlight }: { ctx: ScreenCtx; highlight?: number | null }) {
  const b = ctx.v.battle;
  if (!b || !b.commitments.revealed || b.commitments.cards.length === 0) return null;
  const cards = b.commitments.cards;
  const ids = cardFlipIds(cards.map((c) => ({ owner: c.by, label: c.card })));
  return (
    <div className="ngb-block">
      <span className="ngg-kicker">On the table</span>
      <div className="ngg-cards">
        {cards.map((c, i) => (
          <span key={ids[i]} data-flip-id={ids[i]} className={`ngb-flip${highlight === i ? ' now' : ''}`}>
            <CardFace
              label={c.card}
              effect={cardByLabel(ctx.ref, c.card)?.effect}
              owner={<>{ctx.seat(c.by)} · {c.countered ? 'COUNTERED' : c.resolved ? 'RESOLVED' : 'NOT RESOLVED'}</>}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function DeckLine({ ctx }: { ctx: ScreenCtx }) {
  const total = ctx.ref ? ctx.ref.cards.reduce((n, c) => n + c.copies, 0) : null;
  return (
    <div className="ngb-deck">
      <span>{ctx.v.deckCount} LEFT{total ? ` OF ${total}` : ''}</span>
      <span>{ctx.v.discard.length} IN THE DISCARD</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Move / Battle: from → to → who comes.
// ---------------------------------------------------------------------------

interface MoveStash { stamp: string; from?: string; to?: string; left: string[] }
interface ParkedMove { round: number; from: string; to: string; units: string[] }
const MOVE_KEY = 'ngg:move-battle';
const PARKED_KEY = 'ngg:move-battle:parked';
/** The action (by stamp) in which the person said no to Elara, or she cast. */
const ELARA_DONE_KEY = 'ngg:move-battle:elara-done';

function MoveBattleScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const moves = ctx.movesOf('move_units');
  const skip = ctx.movesOf('skip_action')[0];
  const stamp = `${v.round}:${v.activeAction?.owner ?? ''}:${v.stack.length}`;
  const [raw, setStash] = useStash<MoveStash>(ctx, MOVE_KEY);
  const [elaraDone, setElaraDone] = useStash<string>(ctx, ELARA_DONE_KEY);
  // Elara's spell comes first, before any movement (§6.4): the engine lists
  // it beside the ordinary moves at the start of the action, and the
  // person casts or says no before choosing a move.
  const casts = ctx.movesOf('cast_elara_spell').filter((m) => typeof m.move['target_location'] === 'string');
  const st: MoveStash = raw && raw.stamp === stamp ? raw : { stamp, left: [] };

  const origins = [...new Set(moves.map((m) => asStr(m.move['from'])))];
  const from = st.from && origins.includes(st.from) ? st.from : undefined;
  const fromMoves = from ? moves.filter((m) => m.move['from'] === from) : [];
  // The engine may list several moves to one tile (different units): one row
  // per tile, and the move that takes the most units is the template the
  // person leaves units out of.
  const unitsOf = (m: LegalMove) => asArr(m.move['units']).length;
  const byTile = new Map<string, LegalMove>();
  for (const m of fromMoves) {
    const c = asStr(m.move['to']);
    const had = byTile.get(c);
    if (!had || unitsOf(m) > unitsOf(had)) byTile.set(c, m);
  }
  const destinations = [...byTile.values()];
  const template = st.to ? byTile.get(st.to) : undefined;
  const to = template ? st.to : undefined;
  const movers = template ? asArr(template.move['units']).map((u) => asStr(u)) : [];
  const left = st.left.filter((id) => movers.includes(id));
  const coming = movers.filter((id) => !left.includes(id));
  const live = ctx.live;

  const put = (next: Partial<MoveStash>) => setStash({ ...st, from, to, left, ...next, stamp });
  const pickFrom = (c: string) => put({ from: c, to: undefined, left: [] });
  const pickTo = (c: string) => put({ to: c, left: [] });
  const toggle = (id: string) => put({ left: left.includes(id) ? left.filter((x) => x !== id) : [...left, id] });

  const send = () => {
    if (!template || !to || !from || coming.length === 0) return;
    ctx.memory.set(PARKED_KEY, { round: v.round, from, to, units: coming } satisfies ParkedMove);
    setStash(undefined);
    if (coming.length === movers.length) ctx.send(template);
    else ctx.sendForm(template, { ...template.move, units: coming }, ['units']);
  };

  let marks: MapMarks;
  if (!live || moves.length === 0) marks = {};
  else if (!from) marks = { lit: new Set(origins), greyRest: true, onTile: pickFrom };
  else {
    const tos = [...byTile.keys()];
    marks = { origin: from, lit: new Set(tos), greyRest: true, onTile: pickTo, selected: to ?? null, tags: new Map([[from, 'FROM']]) };
  }

  if (casts.length > 0 && elaraDone !== stamp && ctx.route.perspective === 'decide') {
    return <ElaraScreen ctx={ctx} onDone={() => setElaraDone(stamp)} />;
  }
  // After her spell, movement is optional: the engine's skip then ends the action.
  const afterSpell = elaraDone === stamp && casts.length === 0;

  const mine = ctx.route.perspective === 'decide';
  const panel = (
    <Panel kicker={`Round ${v.round} · ${mine ? 'your' : `${ctx.seat(ctx.route.owner)}'s`} Move / Battle`} title="One tile, as many units as you like">
      {mine && moves.length === 0 && !skip && <HowTo>Nothing to decide here.</HowTo>}
      {mine && !from && origins.length > 0 && (
        <>
          <HowTo>Click a stack on the map, or pick one here.</HowTo>
          <div className="ngg-options">
            {origins.map((o) => {
              const units = asArr(moves.find((m) => m.move['from'] === o)?.move['units']).map((u) => piece(ctx, asStr(u)).name);
              return <OptionRow key={o} title={ctx.tile(o)} sub={units.join(', ')} aside="FROM" disabled={!live} onPress={() => pickFrom(o)} />;
            })}
          </div>
        </>
      )}
      {mine && from && (
        <>
          <div className="ngb-step">
            <span className="ngb-num">1</span><span>From <b>{ctx.tile(from)}</b></span>
            {origins.length > 1 && <Btn kind="quiet" disabled={!live} onClick={() => put({ from: undefined, to: undefined, left: [] })}>Change</Btn>}
          </div>
          <div className="ngb-step"><span className="ngb-num">2</span><span>{to ? <>To <b>{ctx.tile(to)}</b></> : 'Click a lit tile to go there'}</span></div>
          <div className="ngg-options">
            {destinations.map((m) => {
              const c = asStr(m.move['to']);
              const others = othersOn(ctx, c);
              return (
                <OptionRow
                  key={c}
                  title={ctx.tile(c)}
                  sub={[resourceName(ctx, c), ...others.map((o) => `${ctx.seat(o)} here`)].filter(Boolean).join(' · ')}
                  mark={others.length > 0 ? <FactionChip faction={factionOf(ctx, others[0])} size={18} /> : undefined}
                  selected={to === c}
                  disabled={!live}
                  onPress={() => pickTo(c)}
                />
              );
            })}
          </div>
          {to && (
            <div className="ngb-block">
              <span className="ngg-kicker">Who comes · tap a unit to leave it behind</span>
              <div className="ngg-options">
                {movers.map((id) => {
                  const p = piece(ctx, id);
                  const stays = left.includes(id);
                  return <OptionRow key={id} title={p.name} sub={p.stats} selected={!stays} aside={stays ? 'STAYS' : undefined} disabled={!live} onPress={() => toggle(id)} />;
                })}
              </div>
            </div>
          )}
          <Rule>Collectors never move.</Rule>
        </>
      )}
      {mine && (
        <Actions>
          {skip && <Btn kind="secondary" disabled={!live} onClick={() => ctx.send(skip)}>{afterSpell ? 'End without moving' : 'Skip this action'}</Btn>}
          {from && <Btn disabled={!live || !template || coming.length === 0} onClick={send}>{to ? `Move to ${ctx.tile(to)}` : 'Move'}</Btn>}
        </Actions>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={<>{panel}<DiplomacyPanel ctx={ctx} /></>} />;
}

// ---------------------------------------------------------------------------
// Elara's spell: at the start of a Move/Battle action, before any movement.
// Older sessions ask it as a pending (with a skip move); the engine now lists
// the casts beside the ordinary moves, and "Do not cast" goes on to them.
// ---------------------------------------------------------------------------

const ELARA_KEY = 'ngg:elara';

function ElaraScreen({ ctx, onDone }: { ctx: ScreenCtx; onDone?: () => void }) {
  const { v } = ctx;
  const moves = ctx.movesOf('cast_elara_spell');
  const casts = moves.filter((m) => typeof m.move['target_location'] === 'string');
  const skip = moves.find((m) => m.move['skip'] === true);
  const stamp = `${v.round}:${v.stack.length}`;
  const [raw, setStash] = useStash<{ stamp: string; target: string }>(ctx, ELARA_KEY);
  const pick = raw && raw.stamp === stamp ? casts.find((m) => m.move['target_location'] === raw.target) : undefined;
  const target = pick ? asStr(pick.move['target_location']) : null;
  const live = ctx.live;
  const choose = (c: string) => setStash({ stamp, target: c });

  const elara = heroById(ctx.ref, 'elara');
  const elaraAt = elara ? ctx.mine?.heroes.find((h) => h.name === elara.name)?.coord ?? null : null;
  const parkedRaw = ctx.memory.get(PARKED_KEY) as ParkedMove | undefined;
  const parked = parkedRaw && parkedRaw.round === v.round ? parkedRaw : null;
  const occupants = target ? ctx.v.tiles.find((t) => t.coord === target)?.pieces.filter((p) => p.kind !== 'collector') ?? [] : [];

  const marks: MapMarks = live && casts.length
    ? { lit: new Set(casts.map((m) => asStr(m.move['target_location']))), greyRest: true, origin: elaraAt, selected: target, onTile: choose }
    : { origin: elaraAt };

  const mine = ctx.route.perspective === 'decide';
  const panel = (
    <Panel kicker={<>Round {v.round} · Move / Battle <Mana ctx={ctx} /></>} title={`${elara?.name ?? 'Archmage Elara'} may cast first`}>
      {elara && <Rule>{elara.effect}</Rule>}
      {mine && (
        <>
          <HowTo>Click a lit tile to aim the spell.</HowTo>
          <div className="ngg-options">
            {casts.map((m) => {
              const c = asStr(m.move['target_location']);
              const others = othersOn(ctx, c);
              return (
                <OptionRow key={c} title={ctx.tile(c)} sub={[resourceName(ctx, c), ...others.map((o) => `${ctx.seat(o)} here`)].filter(Boolean).join(' · ')}
                  selected={target === c} disabled={!live} onPress={() => choose(c)} />
              );
            })}
          </div>
          {target && occupants.length > 0 && (
            <div className="ngb-block">
              <span className="ngg-kicker">On {ctx.tile(target)}</span>
              <ul className="ngb-seatstates">
                {occupants.map((p, i) => (
                  <li key={`${p.owner}:${p.id ?? p.name}:${i}`}><FactionChip faction={factionOf(ctx, p.owner)} size={16} /><span>{p.name}</span><i>{ctx.seat(p.owner)}</i></li>
                ))}
              </ul>
            </div>
          )}
          <ul className="ngb-facts">
            <li>No battle cards</li><li>No Clerics</li><li>No Decoy</li><li>No Wall first</li>
          </ul>
          {parked && (
            <div className="ngb-step">
              <span className="ngb-num">→</span>
              <span>Then: {parked.units.map((u) => piece(ctx, u).name).join(', ')} to <b>{ctx.tile(parked.to)}</b></span>
            </div>
          )}
          <Actions>
            {(skip || onDone) && <Btn kind="secondary" disabled={!live} onClick={() => { setStash(undefined); if (skip) ctx.send(skip); else onDone?.(); }}>Do not cast</Btn>}
            <Btn disabled={!live || !pick} onClick={() => { if (pick) { setStash(undefined); onDone?.(); ctx.send(pick); } }}>{target ? `Cast at ${ctx.tile(target)}` : 'Cast'}</Btn>
          </Actions>
        </>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Battle Commit and Shared Tactics: one card face down, or none.
// ---------------------------------------------------------------------------

const REVEAL_ORDER = [
  'Every side reveals together',
  'Counters, then Extras',
  'Rally',
  'Retreat',
  'Bonus, then Initiative',
  'Initiative passes — defenders win ties',
];

function heldBy(o: NggOption): string[] {
  return asArr(o.detail['held_by']).map((x) => asStr(x));
}

function pendingStamp(ctx: ScreenCtx): string {
  const { v } = ctx;
  return `${v.round}:${v.battle?.coord ?? ''}:${v.battle?.pass ?? ''}:${v.pending?.kind ?? ''}:${v.pending?.for ?? ''}`;
}

/** The pending's options when they are mine, and the one I picked, if still open. */
function useOptionPick(ctx: ScreenCtx, key: string) {
  const p = ctx.v.pending;
  const options = p && p.for === ctx.me && p.options ? p.options : [];
  const stamp = pendingStamp(ctx);
  const [raw, setStash] = useStash<{ stamp: string; id: string }>(ctx, key);
  const open = (o: NggOption) => !o.blockedReason && !!listed(ctx, o.move);
  const picked = raw && raw.stamp === stamp ? options.find((o) => o.id === raw.id && open(o)) : undefined;
  const choose = (id: string) => setStash({ stamp, id });
  const clear = () => setStash(undefined);
  return { options, picked, choose, clear, open };
}

function NoCard({ selected, onPress, disabled }: { selected: boolean; onPress?: () => void; disabled: boolean }) {
  const inner = (<><span className="ngg-card-type">No card</span><span className="ngg-card-name">No card</span></>);
  if (!onPress) return <div className="ngg-card ngb-nocard">{inner}</div>;
  return <button type="button" className={`ngg-card ngb-nocard${selected ? ' selected' : ''}`} aria-pressed={selected} disabled={disabled} onClick={onPress}>{inner}</button>;
}

function CommitScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const shared = ctx.route.screen === 'shared-tactics';
  const { options, picked, choose, clear, open } = useOptionPick(ctx, 'ngg:commit');
  const live = ctx.live;
  const none = options.find((o) => o.id === 'none');
  const cards = options.filter((o) => o.id !== 'none');
  const yours = shared ? cards.filter((o) => heldBy(o).length === 0 || heldBy(o).includes(ctx.me ?? '')) : cards;
  const theirs = shared ? cards.filter((o) => !yours.includes(o)) : [];
  const partners = [...new Set(theirs.flatMap((o) => heldBy(o)))];
  const bySeat = v.battle && !v.battle.commitments.revealed ? v.battle.commitments.bySeat : {};
  const handIds = cardFlipIds(v.hand.map((c) => ({ owner: ctx.me ?? '', label: c.card })));
  const handIdOf = (label: string) => handIds[v.hand.findIndex((c) => c.card === label)];

  const card = (o: NggOption, tag?: string) => {
    const shut = o.blockedReason ? ctx.say(o.blockedReason) : null;
    const count = asNum(o.detail['count']);
    const effect = asStr(o.detail['effect']) || cardByLabel(ctx.ref, o.label)?.effect;
    const flip = handIdOf(o.label);
    return (
      <span key={o.id} className="ngb-flip" data-flip-id={flip}>
        <CardFace label={o.label} effect={effect} count={count} shutReason={shut} owner={tag}
          selected={picked?.id === o.id} disabled={!live} onPress={open(o) ? () => choose(o.id) : undefined} />
      </span>
    );
  };

  const commit = () => {
    const m = picked ? listed(ctx, picked.move) : undefined;
    if (!m) return;
    clear();
    ctx.send(m);
  };

  const mine = options.length > 0;
  const treaty = shared ? treatyByName(ctx.ref, 'Shared Tactics') : null;
  const panel = (
    <Panel kicker={battleKicker(ctx)} title={shared ? 'Commit one card, or none' : 'Commit one card, face down — or none'} tone={mine ? 'hl' : undefined}>
      <Armies ctx={ctx} />
      {mine && (
        <>
          {shared && <span className="ngg-kicker">Your hand</span>}
          <div className="ngg-cards">
            {none && <NoCard selected={picked?.id === 'none'} disabled={!live} onPress={open(none) ? () => choose('none') : undefined} />}
            {yours.map((o) => card(o))}
          </div>
          {partners.map((pid) => (
            <div key={pid} className="ngb-block">
              <span className="ngg-kicker">
                {ctx.seat(pid)}&rsquo;s hand
                {bySeat[pid] ? ` · ${bySeat[pid] === 'committed' ? 'has committed' : 'has not committed'}` : ''}
              </span>
              <div className="ngg-cards">
                {theirs.filter((o) => heldBy(o).includes(pid)).map((o) => card(o, open(o) ? 'THEIRS · YOURS TO PLAY' : 'THEIRS'))}
              </div>
            </div>
          ))}
          <Actions>
            <Btn disabled={!live || !picked} onClick={commit}>
              {picked ? (picked.id === 'none' ? 'Commit no card' : `Commit ${picked.label}`) : 'Commit'}
            </Btn>
          </Actions>
        </>
      )}
      <Committers ctx={ctx} />
      <Rule>Nobody sees which one, or whether you played any, until every side has committed.</Rule>
      {mine && shared && (
        <>
          <Rule>Committing their card takes it out of their hand, and it goes to the public discard.</Rule>
          <Rule>A card says your units and opposing units. Played through this treaty, those words mean the player laying the card down.</Rule>
          {treaty && <Rule>{treaty.name}: {treaty.effect}</Rule>}
        </>
      )}
      <div className="ngb-block">
        <span className="ngg-kicker">After the reveal</span>
        <Steps items={REVEAL_ORDER} />
      </div>
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={battleMarks(ctx)} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Card Batch: point the Counter.
// ---------------------------------------------------------------------------

function CounterScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const p = v.pending;
  // The options are public: every seat reads the same batches.
  const all = p?.options ?? [];
  const { picked, choose, clear, open } = useOptionPick(ctx, 'ngg:counter');
  const live = ctx.live && p?.for === ctx.me;
  const counterId = asStr(p?.context['counter']);
  const batches = asArr(p?.context['batches']).filter(isObj).map((b) => ({
    batch: asNum(b['batch']),
    ids: asArr(b['option_ids']).map((x) => asStr(x)),
  }));
  const grouped = batches.length > 0 ? batches : [{ batch: 0, ids: all.map((o) => o.id) }];
  const cardOf = (o: NggOption) => asStr(o.detail['card']) || o.label;
  const byOf = (o: NggOption) => asStr(o.detail['played_by']);
  const ids = cardFlipIds(all.map((o) => ({ owner: byOf(o), label: cardOf(o) })));

  const confirm = () => {
    const m = picked ? listed(ctx, picked.move) : undefined;
    if (!m) return;
    clear();
    ctx.send(m);
  };

  const panel = (
    <Panel kicker={battleKicker(ctx)} title={p?.for === ctx.me ? 'Your Counter resolves — point it at something' : `${ctx.seat(p?.for)}'s Counter resolves`} tone={p?.for === ctx.me ? 'hl' : undefined}>
      {p?.for === ctx.me && <HowTo>Pick a card that has not resolved.</HowTo>}
      {grouped.map((g) => (
        <div key={g.batch} className="ngb-block">
          <span className="ngg-kicker">Batch {g.batch + 1}</span>
          <div className="ngg-cards">
            {g.ids.map((id) => {
              const i = all.findIndex((o) => o.id === id);
              const o = all[i];
              if (!o) return null;
              const isCounter = o.id === counterId;
              const by = byOf(o);
              const state = isCounter ? (by === ctx.me ? 'YOURS · CHOOSING ITS TARGET' : 'CHOOSING ITS TARGET') : o.blockedReason ? null : 'CAN BE HIT';
              return (
                <span key={o.id} className={`ngb-flip${isCounter ? ' now' : ''}`} data-flip-id={ids[i]}>
                  <CardFace
                    label={cardOf(o)}
                    effect={cardByLabel(ctx.ref, cardOf(o))?.effect}
                    owner={<>{ctx.seat(by)}{state ? ` · ${state}` : ''}</>}
                    shutReason={o.blockedReason ? ctx.say(o.blockedReason) : null}
                    selected={picked?.id === o.id}
                    disabled={!live}
                    onPress={live && open(o) ? () => choose(o.id) : undefined}
                  />
                </span>
              );
            })}
          </div>
        </div>
      ))}
      {p?.for === ctx.me && (
        <Actions>
          <Btn disabled={!live || !picked} onClick={confirm}>
            {picked ? `Counter ${ctx.seat(byOf(picked))}'s ${cardOf(picked)}` : 'Counter'}
          </Btn>
        </Actions>
      )}
      <Rule>Both cards go face up to the public discard — the one that countered and the one that was countered. Neither returns to a hand.</Rule>
      <DeckLine ctx={ctx} />
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={battleMarks(ctx)} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Battle Extra: none, one or two, turned over together.
// ---------------------------------------------------------------------------

const EXTRA_KEY = 'ngg:extra';

function sameCards(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');
}

function ExtraScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const p = v.pending;
  const options = p && p.for === ctx.me && p.options ? p.options : [];
  const max = asNum(p?.context['max'], 2);
  const stamp = pendingStamp(ctx);
  const [raw, setStash] = useStash<{ stamp: string; cards: string[] }>(ctx, EXTRA_KEY);
  const live = ctx.live;
  const none = options.find((o) => o.id === 'none');
  const kinds = options.filter((o) => o.id !== 'none');
  const openKinds = kinds.filter((o) => !o.blockedReason && o.move);
  // Only picks of cards still offered survive a new state.
  const picks = (raw && raw.stamp === stamp ? raw.cards : []).filter((c) => openKinds.some((o) => o.label === c));
  const exact = ctx.movesOf('select_extra_cards').find((m) => sameCards(asArr(m.move['cards']).map((x) => asStr(x)), picks));

  const tap = (o: NggOption) => {
    const have = picks.filter((c) => c === o.label).length;
    const copies = asNum(o.detail['count'], 1);
    const next = have > 0 && (have >= copies || picks.length >= max)
      ? picks.filter((c) => c !== o.label)
      : picks.length < max ? [...picks, o.label] : picks;
    setStash({ stamp, cards: next });
  };

  const handIds = cardFlipIds(v.hand.map((c) => ({ owner: ctx.me ?? '', label: c.card })));
  const mine = options.length > 0;
  const panel = (
    <Panel kicker={battleKicker(ctx)} title={mine ? 'Your Extra survived — it may add up to two' : 'An Extra adds cards'} tone={mine ? 'hl' : undefined}>
      {mine && (
        <>
          <HowTo>Choose none, one or two.</HowTo>
          <span className="ngg-kicker">{picks.length} of {max} chosen</span>
          {kinds.length > 0 ? (
            <div className="ngg-cards">
              {kinds.map((o) => {
                const n = picks.filter((c) => c === o.label).length;
                const flip = handIds[v.hand.findIndex((c) => c.card === o.label)];
                return (
                  <span key={o.id} className="ngb-flip" data-flip-id={flip}>
                    <CardFace label={o.label} effect={asStr(o.detail['effect']) || cardByLabel(ctx.ref, o.label)?.effect}
                      count={asNum(o.detail['count'])} shutReason={o.blockedReason ? ctx.say(o.blockedReason) : null}
                      selected={n > 0} owner={n > 1 ? `×${n} CHOSEN` : undefined} disabled={!live}
                      onPress={!o.blockedReason && o.move ? () => tap(o) : undefined} />
                  </span>
                );
              })}
            </div>
          ) : <HowTo>No cards in hand.</HowTo>}
        </>
      )}
      {mine && (
        <Actions>
          {none && listed(ctx, none.move) && (
            <Btn kind="secondary" disabled={!live} onClick={() => { const m = listed(ctx, none.move); if (m) { setStash(undefined); ctx.send(m); } }}>Add none</Btn>
          )}
          <Btn disabled={!live || picks.length === 0 || !exact} onClick={() => { if (exact) { setStash(undefined); ctx.send(exact); } }}>
            {picks.length === 2 ? 'Reveal both together' : 'Reveal together'}
          </Btn>
        </Actions>
      )}
      {mine && (
        <>
          <Rule>They are picked in secret and turned over together. Nothing you add acts in this batch.</Rule>
          <Rule>A countered Extra adds nothing and its cards stay secret.</Rule>
        </>
      )}
      <Revealed ctx={ctx} />
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={battleMarks(ctx)} panel={panel} />;
}

// ---------------------------------------------------------------------------
// The battle cards resolve: nothing to press, the table as it stands.
// ---------------------------------------------------------------------------

function CardsScreen({ ctx }: { ctx: ScreenCtx }) {
  const panel = (
    <Panel kicker={battleKicker(ctx)} title="The battle cards resolve">
      <Armies ctx={ctx} />
      <Revealed ctx={ctx} />
      <Committers ctx={ctx} />
      <DeckLine ctx={ctx} />
      <div className="ngb-block">
        <span className="ngg-kicker">After the reveal</span>
        <Steps items={REVEAL_ORDER} />
      </div>
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={battleMarks(ctx)} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Activation (and the Infiltrator's hero, and the initiative tie).
// ---------------------------------------------------------------------------

const ACTION_NAMES: Record<string, string> = {
  attack: 'Attack',
  'ability:wizard_missile': 'Wizard Missile',
  'ability:ice_blast': 'Ice Blast',
  'ability:fiery_explosion': 'Fiery Explosion',
  'ability:enhance': 'Enhance',
  'ability:dehance': 'Dehance',
  spy_attack: 'Spy Attack',
  invisible: 'Invisible',
  self_destruct: 'Self Destruct',
};

function actionOf(m: LegalMove): Record<string, unknown> {
  const a = m.move['action'];
  return isObj(a) ? a : {};
}

/** The unit an action is aimed at; null for one aimed at nobody (an area
 *  attack hits every opposing unit, and the engine lists it with an empty
 *  target). */
function targetOf(m: LegalMove): string | null {
  const t = actionOf(m)['target'];
  return typeof t === 'string' && t !== '' ? t : null;
}

function groupKey(m: LegalMove): string {
  const a = actionOf(m);
  const kind = asStr(a['kind']);
  return kind === 'ability' ? `ability:${asStr(a['ability'])}` : kind;
}

/** Printed text for an action, from the catalogue: a research card by name. */
function actionText(ctx: ScreenCtx, key: string): string | null {
  const name = ACTION_NAMES[key];
  return name ? researchByName(ctx.ref, name)?.effect ?? null : null;
}

const ACT_KEY = 'ngg:activation';

function Ladder({ ctx, acting, pick }: {
  ctx: ScreenCtx;
  acting: string | null;
  pick?: { refs: string[]; selected: string | null; onPick: (ref: string) => void; live: boolean };
}) {
  const b = ctx.v.battle;
  if (!b) return null;
  const rows = [...b.units].sort((x, y) => y.init - x.init);
  return (
    <div className="ngb-block">
      <span className="ngg-kicker">This pass</span>
      <ol className="ngb-ladder">
        {rows.map((u) => {
          const pickable = !!pick && !!u.ref && pick.refs.includes(u.ref);
          const state = u.activated ? 'acted' : u.ref && u.ref === acting ? 'acting now' : '';
          const body = (
            <>
              <span className="ngb-init">{u.init}</span>
              <FactionChip faction={factionOf(ctx, u.owner)} size={16} />
              <span className="ngg-unit-name">{u.label}</span>
              <span className="ngg-unit-stats">DMG {u.dmg} · DEF {u.def}</span>
              {state && <span className="ngb-state">{state}</span>}
            </>
          );
          const cls = `ngb-rung${u.activated ? ' acted' : ''}${u.ref === acting ? ' acting' : ''}${pickable && pick?.selected === u.ref ? ' selected' : ''}`;
          return (
            <li key={u.ref ?? u.label} data-flip-id={`ngg-rung:${u.ref ?? u.label}`}>
              {pickable
                ? <button type="button" className={`${cls} pick`} disabled={!pick!.live} aria-pressed={pick!.selected === u.ref} onClick={() => pick!.onPick(u.ref!)}>{body}</button>
                : <div className={cls}>{body}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ActivationScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const b = v.battle;
  const infiltrator = ctx.route.screen === 'infiltrator';
  const acts = ctx.movesOf('battle_activation');
  const tie = v.pending?.kind === 'initiative_tie';
  const live = ctx.live;
  const stamp = `${pendingStamp(ctx)}:${acts.map((m) => asStr(m.move['unit'])).join(',')}`;
  const [raw, setStash] = useStash<{ stamp: string; group?: string; target?: string }>(ctx, ACT_KEY);
  const st = raw && raw.stamp === stamp ? raw : { stamp };

  // The initiative tie: each tied unit is one listed move (choose_initiative_order;
  // an older engine listed the tied units' activations instead).
  if (tie) {
    const order = ctx.movesOf('choose_initiative_order');
    const picks = order.length > 0 ? order : acts;
    const refs = picks.map((m) => asStr(m.move['unit']));
    const sel = st.target && refs.includes(st.target) ? st.target : null;
    const move = sel ? picks.find((m) => m.move['unit'] === sel) : undefined;
    const mine = v.pending?.for === ctx.me;
    const panel = (
      <Panel kicker={battleKicker(ctx, true)} title={mine ? 'Tied initiative — pick who acts next' : 'Tied initiative'} tone={mine ? 'hl' : undefined}>
        <Ladder ctx={ctx} acting={null} pick={mine ? { refs, selected: sel, onPick: (r) => setStash({ stamp, target: r }), live } : undefined} />
        {mine && (
          <Actions>
            <Btn disabled={!live || !move} onClick={() => { if (move) { setStash(undefined); ctx.send(move); } }}>
              {sel ? `Let ${battleUnit(ctx, sel)?.label ?? piece(ctx, sel).name} act next` : 'Act next'}
            </Btn>
          </Actions>
        )}
      </Panel>
    );
    return <TableLayout ctx={ctx} marks={battleMarks(ctx)} panel={panel} />;
  }

  const unit = acts.length > 0 ? asStr(acts[0]!.move['unit']) : null;
  const me = battleUnit(ctx, unit);
  const pass = acts.find((m) => asStr(actionOf(m)['kind']) === 'pass');
  const groups = new Map<string, LegalMove[]>();
  for (const m of acts) {
    const k = groupKey(m);
    if (k === 'pass') continue;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const group = st.group && groups.has(st.group) ? st.group : null;
  const gMoves = group ? groups.get(group)! : [];
  const targeted = gMoves.some((m) => targetOf(m) !== null);
  const target = targeted && st.target && gMoves.some((m) => targetOf(m) === st.target) ? st.target : null;
  const chosen = group ? (targeted ? gMoves.find((m) => targetOf(m) === target) : gMoves[0]) : undefined;
  const nameOf = (k: string) => ACTION_NAMES[k] ?? k.replace(/^ability:/, '').replace(/_/g, ' ');
  const spyTag = (k: string) => (k === 'spy_attack' || k === 'invisible' ? 'REVEALS AND SPENDS THE SPY'
    : k === 'self_destruct' ? 'HITS EVERY SIDE · THIS UNIT IS LOST' : infiltrator ? 'SPY UNTOUCHED' : undefined);
  const go = (m: LegalMove | undefined) => { if (m) { setStash(undefined); ctx.send(m); } };

  const acting = unit;
  const title = me ? `${me.label} activates` : unit ? `${piece(ctx, unit).name} activates` : 'Activations';
  const panel = (
    <Panel kicker={<>{battleKicker(ctx, true)} <Mana ctx={ctx} /></>} title={title} tone={acts.length ? 'hl' : undefined}>
      {acts.length > 0 && (
        <>
          {me && <span className="ngg-kicker">{statLine(me.init, me.dmg, me.def)}</span>}
          <Rule>One attack or one ability, not both. Passing spends the activation too.</Rule>
          <div className="ngg-options">
            {[...groups.keys()].map((k) => {
              // An action aimed at nobody (an area attack, a Self Destruct) says
              // what it does in the engine's words, which carry the damage.
              const aimless = groups.get(k)!.every((m) => targetOf(m) === null) && (k === 'attack' || k === 'self_destruct');
              const text = (aimless ? ctx.say(groups.get(k)![0]!.description ?? '') || null : null) ?? actionText(ctx, k);
              return (
                <OptionRow key={k} title={nameOf(k)} sub={[spyTag(k), text].filter(Boolean).join(' · ') || undefined}
                  selected={group === k} disabled={!live} onPress={() => setStash({ stamp, group: k })} />
              );
            })}
          </div>
          {group && targeted && (
            <div className="ngb-block">
              <span className="ngg-kicker">Pick a target · for {nameOf(group)}</span>
              <div className="ngg-options">
                {gMoves.filter((m) => targetOf(m) !== null).map((m) => {
                  const t = targetOf(m)!;
                  const bu = battleUnit(ctx, t);
                  return (
                    <OptionRow key={t} title={bu?.label ?? piece(ctx, t).name}
                      sub={bu ? `${ctx.seat(bu.owner)} · ${statLine(bu.init, bu.dmg, bu.def)}` : undefined}
                      mark={bu ? <FactionChip faction={factionOf(ctx, bu.owner)} size={18} /> : undefined}
                      selected={target === t} disabled={!live} onPress={() => setStash({ stamp, group: group!, target: t })} />
                  );
                })}
              </div>
            </div>
          )}
          <Actions>
            {pass && <Btn kind="secondary" disabled={!live} onClick={() => go(pass)}>Pass the activation</Btn>}
            {groups.size > 0 && (
              <Btn disabled={!live || !chosen} onClick={() => go(chosen)}>
                {group ? `${nameOf(group)}${target ? ` ${battleUnit(ctx, target)?.label ?? piece(ctx, target).name}` : ''}` : 'Act'}
              </Btn>
            )}
          </Actions>
        </>
      )}
      <Ladder ctx={ctx} acting={acting} />
      <Rule>Highest initiative first, both sides in one line. Each unit acts once.</Rule>
      <Rule>If a whole pass kills nobody, the battle is a stalemate{b?.origin && v.tiles.some((t) => t.coord === b.origin) ? ` and every attacker still here goes back to ${ctx.tile(b.origin)}` : ''}.</Rule>
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={battleMarks(ctx)} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Battle Defense (and the Spy Reveal): an interrupt, one target, one step.
// ---------------------------------------------------------------------------

function DefenseScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const p = v.pending;
  const { options, picked, choose, clear, open } = useOptionPick(ctx, 'ngg:defense');
  const live = ctx.live;
  const c = p?.context ?? {};
  const mine = options.length > 0;
  const none = options.find((o) => o.id === 'none');
  const rest = options.filter((o) => o.id !== 'none');
  const decoys = rest.filter((o) => o.id.startsWith('decoy:') && open(o));
  const spyReveal = asStr(c['step']) === 'decoy' && decoys.length > 0;
  const dmg = c['damage'];
  const attackKind = asStr(c['attack_kind']);
  const decoyText = researchByName(ctx.ref, 'Decoy')?.effect ?? null;

  const aside = (o: NggOption): ReactNode => {
    if (typeof o.detail['survives'] === 'boolean') return o.detail['survives'] ? 'SURVIVES' : 'DOES NOT SURVIVE';
    if (typeof o.detail['mana_cost'] === 'number') return `${o.detail['mana_cost']} mana`;
    if (o.id.startsWith('decoy:')) return 'SPENDS THE SPY';
    return undefined;
  };
  const send = (o: NggOption | undefined) => {
    const m = o ? listed(ctx, o.move) : undefined;
    if (!m) return;
    clear();
    ctx.send(m);
  };

  const moveToOf = (o: NggOption) => {
    const d = o.move?.['defense'];
    return isObj(d) ? asStr(d['moveTo']) : '';
  };
  const lit = new Set(decoys.map(moveToOf).filter(Boolean));
  const pickedTo = picked ? moveToOf(picked) : '';
  const marks = battleMarks(ctx, spyReveal && live ? { lit, selected: pickedTo || null } : {});

  const body = (
    <Panel kicker={<>{mine ? 'The table is stopped · ON YOU' : battleKicker(ctx, true)} <Mana ctx={ctx} /></>}
      title={mine ? (spyReveal ? `${asStr(c['target'])} is the target` : c['self_destruct'] === true ? `${asStr(c['attacker'])}'s blast hits ${asStr(c['target'])}` : `${asStr(c['attacker'])} attacks ${asStr(c['target'])}`) : 'A defense is being decided'}
      tone={mine ? 'urgent' : undefined}>
      {mine && (
        <>
          {spyReveal && <span className="ngg-kicker">{asStr(c['attacker'])} attacks</span>}
          {c['self_destruct'] === true && <span className="ngg-kicker">Self Destruct · {asStr(c['attacker'])} blows itself up, hitting every side</span>}
          <div className="ngb-hit">
            {typeof dmg === 'number'
              ? <><b>{dmg}</b> damage vs DEF <b>{asNum(c['target_def'])}</b></>
              : <>{attackKind.replace(/[-_]/g, ' ')}</>}
          </div>
          {spyReveal && decoyText && <Rule>{decoyText}</Rule>}
          <div className="ngg-options">
            {rest.map((o) => (
              <OptionRow key={o.id} title={ctx.say(o.label)} aside={aside(o)} shutReason={o.blockedReason ? ctx.say(o.blockedReason) : null}
                selected={picked?.id === o.id} disabled={!live} onPress={open(o) ? () => choose(o.id) : undefined} />
            ))}
          </div>
          <Rule>A hit lands when damage equals defense.</Rule>
          <Rule>Protection is chosen before any casualty is taken off the board.</Rule>
          {asStr(c['step']) === 'cleric' && <Rule>One save per Cleric per pass, and the Cleric&rsquo;s owner pays.</Rule>}
          <Actions>
            {none && <Btn kind="secondary" disabled={!live || !open(none)} onClick={() => send(none)}>{spyReveal ? 'Let it land' : none.label}</Btn>}
            <Btn disabled={!live || !picked || picked.id === 'none'} onClick={() => send(picked)}>{picked && picked.id !== 'none' ? ctx.say(picked.label) : spyReveal ? 'Reveal the Decoy' : 'Defend'}</Btn>
          </Actions>
        </>
      )}
      <Armies ctx={ctx} />
    </Panel>
  );
  return ctx.route.interrupt
    ? <TableLayout ctx={ctx} marks={marks} interrupt={body} />
    : <TableLayout ctx={ctx} marks={marks} panel={body} />;
}

// ---------------------------------------------------------------------------
// Retreat, or stay in.
// ---------------------------------------------------------------------------

function RetreatScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const b = v.battle;
  const moves = ctx.movesOf('choose_retreat');
  const stay = moves.find((m) => m.move['stay'] === true);
  const dests = moves.filter((m) => typeof m.move['destination'] === 'string');
  const stamp = pendingStamp(ctx);
  const [raw, setStash] = useStash<{ stamp: string; to: string }>(ctx, 'ngg:retreat');
  const pick = raw && raw.stamp === stamp ? dests.find((m) => m.move['destination'] === raw.to) : undefined;
  const to = pick ? asStr(pick.move['destination']) : null;
  const live = ctx.live;
  const choose = (c: string) => setStash({ stamp, to: c });
  const go = (m: LegalMove | undefined) => { if (m) { setStash(undefined); ctx.send(m); } };
  const mine = moves.length > 0;
  const group = b?.units.filter((u) => u.owner === ctx.me) ?? [];

  const marks = battleMarks(ctx, mine && live ? { lit: new Set(dests.map((m) => asStr(m.move['destination']))), greyRest: true, selected: to, onTile: choose } : {});
  const panel = (
    <Panel kicker={battleKicker(ctx, true)} title={mine ? 'Retreat, or stay in' : 'Retreats are being decided'} tone={mine ? 'hl' : undefined}>
      {mine && (
        <>
          <span className="ngg-kicker">Everyone goes, or nobody does</span>
          {group.length > 0 && (
            <ul className="ngb-seatstates">
              {group.map((u) => <li key={u.ref ?? u.label}><FactionChip faction={factionOf(ctx, u.owner)} size={16} /><span>{u.label}</span><i>{statLine(u.init, u.dmg, u.def)}</i></li>)}
            </ul>
          )}
          {dests.length > 0 && <HowTo>Tap a tile to go there.</HowTo>}
          <div className="ngg-options">
            {dests.map((m) => {
              const c = asStr(m.move['destination']);
              return <OptionRow key={c} title={[ctx.tile(c), resourceName(ctx, c)].filter(Boolean).join(' · ')} selected={to === c} disabled={!live} onPress={() => choose(c)} />;
            })}
          </div>
          <Actions>
            {stay && <Btn kind="secondary" disabled={!live} onClick={() => go(stay)}>Stay in</Btn>}
            {dests.length > 0 && <Btn disabled={!live || !pick} onClick={() => go(pick)}>{to ? `Retreat to ${ctx.tile(to)}` : 'Retreat'}</Btn>}
          </Actions>
          {b?.origin && <Rule>{ctx.tile(b.origin)}: the attack came from here.</Rule>}
          <Rule>All your mobile units leave together; you cannot split them between two tiles.</Rule>
          <Rule>A collector never retreats with an army. An Immobile Combat Platform cannot retreat either.</Rule>
        </>
      )}
      <Armies ctx={ctx} />
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Rally: any of the listed units, or nobody.
// ---------------------------------------------------------------------------

function RallyScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const moves = ctx.movesOf('select_rally_units');
  const eligible: string[] = [];
  for (const m of moves) for (const u of asArr(m.move['units'])) if (!eligible.includes(asStr(u))) eligible.push(asStr(u));
  const stamp = pendingStamp(ctx);
  const [raw, setStash] = useStash<{ stamp: string; units: string[] }>(ctx, 'ngg:rally');
  const picks = eligible.filter((id) => raw && raw.stamp === stamp && raw.units.includes(id));
  const live = ctx.live;
  const mine = moves.length > 0;
  const nobody = moves.find((m) => asArr(m.move['units']).length === 0);
  const toggle = (id: string) => setStash({ stamp, units: picks.includes(id) ? picks.filter((x) => x !== id) : [...picks, id] });
  const bring = () => {
    if (picks.length === 0) return;
    const exact = moves.find((m) => sameCards(asArr(m.move['units']).map((x) => asStr(x)), picks));
    const template = exact ?? nobody ?? moves[0];
    if (!template) return;
    setStash(undefined);
    if (exact) ctx.send(exact);
    else ctx.sendForm(template, { ...template.move, units: picks }, ['units']);
  };
  const rally = cardByLabel(ctx.ref, 'Rally');
  const coords = new Set(eligible.map((id) => piece(ctx, id).coord).filter((c): c is string => !!c));
  const marks = battleMarks(ctx, mine ? { lit: coords, greyRest: true } : {});

  const panel = (
    <Panel kicker={battleKicker(ctx)} title="Rally" tone={mine ? 'hl' : undefined}>
      {rally && <Rule>{rally.effect}</Rule>}
      {mine && (
        <>
          {eligible.length > 0 && <HowTo>Tap a unit to bring it in.</HowTo>}
          <div className="ngg-options">
            {eligible.map((id) => {
              const pc = piece(ctx, id);
              return (
                <OptionRow key={id} title={pc.name} sub={[pc.coord ? `FROM ${ctx.tile(pc.coord)}` : null, pc.stats].filter(Boolean).join(' · ')}
                  selected={picks.includes(id)} disabled={!live} onPress={() => toggle(id)} />
              );
            })}
          </div>
          <Actions>
            {nobody && <Btn kind="secondary" disabled={!live} onClick={() => { setStash(undefined); ctx.send(nobody); }}>Bring nobody</Btn>}
            {eligible.length > 0 && <Btn disabled={!live || picks.length === 0} onClick={bring}>{`Bring ${picks.length}`}</Btn>}
          </Actions>
          <Rule>Reinforcements arrive before anyone retreats.</Rule>
          <Rule>Only your own units. Collectors never go into a fight, and an Immobile Combat Platform never leaves its base.</Rule>
        </>
      )}
      <Armies ctx={ctx} />
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

export const BATTLE_SCREENS: Partial<Record<ScreenKey, Screen>> = {
  'move-battle': MoveBattleScreen,
  'elara-spell': ElaraScreen,
  'battle-commit': CommitScreen,
  'shared-tactics': CommitScreen,
  'counter-target': CounterScreen,
  'battle-extra': ExtraScreen,
  'battle-cards': CardsScreen,
  'battle-activation': ActivationScreen,
  infiltrator: ActivationScreen,
  'battle-defense': DefenseScreen,
  retreat: RetreatScreen,
  rally: RallyScreen,
};
