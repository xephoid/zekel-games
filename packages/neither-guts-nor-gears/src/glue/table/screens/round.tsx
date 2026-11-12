// NGnG screens: round. Setup (factions, the Leader draft, starting sites),
// planning, the upkeep Core reallocation, the report-a-draw overlay, the
// treaty decisions, the hero decisions, the spy, and the end. See
// docs/design/SCREEN-ROUTING.md for the routes.
//
// Every screen here follows the same few rules:
//   - the option set is the pending's own options when it has them, else the
//     seat's listed moves; nothing the engine did not list is drawn as open,
//     and a shut option carries the engine's reason and nothing else;
//   - a choice is a selection the person makes and then a press that sends
//     it; nothing is selected for them, and nothing is sent without a press;
//   - a composed move (setup factions, Core reallocation, a reported draw) is
//     a listed template with only its editable key changed;
//   - text is state, printed card or rules text, or a short how-to line.

import { useCallback, useState, type ComponentType, type ReactNode } from 'react';
import type { LegalMove } from '@zekel/glue-kit';
import { isObj } from '@zekel/glue-kit';
import { movesEqual } from '@zekel/glue-kit';
import type { ScreenCtx } from '../ctx.js';
import type { ScreenKey } from '../route.js';
import type { MapMarks } from '../HexMap.js';
import { TableLayout } from '../Layout.js';
import { TREATY_INK, inkOfSeat } from '../factions.js';
import { heroByName, itemByName, treatyByName, type RefHero } from '../ref.js';
import { Actions, Btn, CardFace, FactionChip, HeroFacts, HeroName, HowTo, Icon, OptionRow, Panel, ResourceChip, Rule, SeatBand, Token } from '../ui.js';
import './round.css';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Composer state that lives in the seat's memory, so it survives a re-render
 *  from a new event and a remount of the same screen. */
function useScratch<T>(ctx: ScreenCtx, key: string, init: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => (ctx.memory.has(key) ? (ctx.memory.get(key) as T) : init));
  const { memory } = ctx;
  const set = useCallback((next: T) => {
    memory.set(key, next);
    setValue(next);
  }, [memory, key]);
  return [value, set];
}

/** The listed move equal to `move`, if the engine listed it. */
function listedMove(ctx: ScreenCtx, move: Record<string, unknown> | null | undefined): LegalMove | undefined {
  return move ? ctx.legal.find((m) => movesEqual(m.move, move)) : undefined;
}

function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

function num(x: unknown): number | null {
  return typeof x === 'number' ? x : null;
}

/** The pending is this seat's own. */
function minePending(ctx: ScreenCtx, kind: string): boolean {
  return ctx.v.pending?.kind === kind && ctx.v.pending.for === ctx.me;
}

const CARD_NAME: Record<string, string> = { build: 'Build', research: 'Research', move_battle: 'Move / Battle' };
const CARD_ICON: Record<string, string> = { build: 'Build', research: 'Research', move_battle: 'Move / Battle' };

/** One hero as the draft, the claim and the spy show it: the same facts as
 *  the Heroes list (the star, kind and species limit, battle stats, and the
 *  ability on one line), the whole ability once the hero is selected. */
function HeroOption({ ctx, name, hero, stats, selected, onPress, aside }: {
  ctx: ScreenCtx;
  name: string;
  hero: RefHero | null;
  /** the engine's live stat line for a held hero */
  stats?: string | null;
  selected: boolean;
  onPress?: () => void;
  aside?: ReactNode;
}) {
  return (
    <div data-flip-id={`ngg-hero-card:${name}`}>
      <OptionRow
        mark={<Token kind="hero" faction={ctx.mine?.faction ?? null} name={name} state="dashed" size={26} />}
        title={<HeroName hero={hero} name={name} />}
        sub={<span className="ngg-hero-body"><HeroFacts hero={hero} liveStats={stats ?? null} open={selected} /></span>}
        aside={aside}
        selected={selected}
        disabled={!ctx.live}
        onPress={onPress}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Table: one reporter assigns every seat's faction in one move
// ---------------------------------------------------------------------------

function SetupTable({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  const template = ctx.movesOf('assign_setup_choices')[0] ?? null;
  const factions = ref?.factions ?? [];
  const seatIds = template && isObj(template.move['selections']) ? Object.keys(template.move['selections']) : v.players.map((p) => p.id);
  const [raw, setRaw] = useScratch<Record<string, string>>(ctx, 'ngg:setup-table', {});
  // Only what still fits the listed template and the printed factions counts.
  const picks: Record<string, string> = {};
  for (const [pid, fid] of Object.entries(raw)) {
    if (seatIds.includes(pid) && factions.some((f) => f.id === fid)) picks[pid] = fid;
  }
  const complete = !!template && seatIds.every((pid) => picks[pid]);
  const live = ctx.live && !!template;
  const send = () => {
    if (!template || !complete) return;
    const selections = Object.fromEntries(seatIds.map((pid) => [pid, picks[pid]!]));
    ctx.memory.delete('ngg:setup-table');
    ctx.sendForm(template, { ...template.move, selections }, ['selections']);
  };
  const panel = (
    <Panel title="Set up the table" kicker={`Seats · ${seatIds.length}`}>
      {template ? <HowTo>Pick a faction for every seat, then start the Leader draft.</HowTo> : null}
      <div className="ngr-setup-seats">
        {seatIds.map((pid) => {
          const player = v.players.find((p) => p.id === pid);
          const chosen = factions.find((f) => f.id === picks[pid]) ?? null;
          return (
            <div key={pid} className="ngr-setup-seat">
              <div className="ngr-setup-who">
                <FactionChip faction={chosen?.name ?? player?.faction ?? null} size={22} />
                <b>{ctx.seat(pid)}{pid === ctx.me ? ' · you' : ''}</b>
                <span className="muted">{player?.kind ?? ''}</span>
                <span className="ngr-grow" />
                <span className="ngr-setup-state">{chosen ? `${chosen.name} · ${chosen.species}` : player?.faction ?? 'No faction'}</span>
              </div>
              {template && (
                <div className="ngr-factions" role="radiogroup" aria-label={`Faction for ${ctx.seat(pid)}`}>
                  {factions.map((f) => {
                    const on = picks[pid] === f.id;
                    const elsewhere = Object.entries(picks).find(([other, fid]) => other !== pid && fid === f.id)?.[0] ?? null;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={`ngr-faction${on ? ' on' : ''}`}
                        disabled={!live}
                        onClick={() => setRaw({ ...picks, [pid]: f.id })}
                      >
                        <FactionChip faction={f.name} size={18} />
                        <span className="ngr-faction-name">{f.name}<i>{f.species}{elsewhere ? ` · ${ctx.seat(elsewhere)}` : ''}</i></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {template && (
        <Actions>
          <Btn disabled={!live || !complete} onClick={send}>Start the Leader draft</Btn>
        </Actions>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Setup Draft: the Leader, from the listed heroes
// ---------------------------------------------------------------------------

function SetupDraft({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  const moves = ctx.movesOf('choose_leader');
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:setup-draft', null);
  const sel = moves.find((m) => str(m.move['hero']) === raw) ?? null;
  const leaders = v.players.flatMap((p) => p.heroes.filter((h) => h.leader).map((h) => ({ pid: p.id, h })));
  const decide = minePending(ctx, 'choose_leader');
  const panel = (
    <Panel title="Draft your Leader" kicker={`${v.heroPoolCount} in the pool`}>
      {decide && moves.length > 0 && <HowTo>Tap a hero, then take them.</HowTo>}
      {moves.length > 0 && (
        <div className="ngg-options ngr-scroll">
          {moves.map((m) => {
            const name = str(m.move['hero']);
            return (
              <HeroOption key={name} ctx={ctx} name={name} hero={heroByName(ref, name)} selected={sel === m}
                onPress={() => setSel(name)} />
            );
          })}
        </div>
      )}
      {leaders.length > 0 && (
        <>
          <div className="ngg-kicker">Leaders drafted</div>
          <ul className="ngr-list">
            {leaders.map(({ pid, h }) => (
              <li key={h.name} data-flip-id={`ngg-hero:${h.name}`}>
                <Token kind="hero" faction={v.players.find((p) => p.id === pid)?.faction ?? null} name={h.name} leader size={20} state={h.coord ? 'solid' : 'dashed'} />
                <span>{h.name}</span>
                <span className="muted">{ctx.seat(pid)}{h.stats ? ` · ${h.stats}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !sel} onClick={() => sel && ctx.send(sel)}>{sel ? `Take ${str(sel.move['hero'])}` : 'Take a hero'}</Btn>
        </Actions>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Setup Start: a numbered starting site
// ---------------------------------------------------------------------------

function siteNumber(location: unknown): number | null {
  const m = /^@(\d+)$/.exec(str(location));
  return m ? parseInt(m[1]!, 10) : null;
}

function SetupStart({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const moves = ctx.movesOf('choose_starting_location');
  const sites = v.tiles.filter((t) => t.start !== null).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const moveFor = (n: number | null) => moves.find((m) => siteNumber(m.move['location']) === n) ?? null;
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:setup-start', null);
  const selTile = sites.find((t) => t.coord === raw && moveFor(t.start)) ?? null;
  const selMove = selTile ? moveFor(selTile.start) : null;
  const decide = minePending(ctx, 'choose_starting_location');
  const lit = new Set(sites.filter((t) => moveFor(t.start)).map((t) => t.coord));
  const marks: MapMarks = {
    lit: decide ? lit : undefined,
    greyRest: decide,
    selected: selTile?.coord ?? null,
    onTile: ctx.live ? (coord) => setSel(coord) : undefined,
    proposals: selTile ? [{ coord: selTile.coord, owner: ctx.me ?? '', kind: 'base', name: 'Base', key: 'start-base' }] : [],
  };
  const leader = v.reservedHeroes[0] ?? null;
  const panel = (
    <Panel title="Choose a starting site">
      {decide && <HowTo>Tap a numbered site.</HowTo>}
      <div className="ngg-options">
        {sites.map((t) => {
          const m = moveFor(t.start);
          const owner = t.baseOwner;
          return (
            <OptionRow
              key={t.coord}
              mark={<span className="ngr-site">{t.start}</span>}
              title={`Site ${t.start} · ${t.label}`}
              sub={owner ? `Taken · ${ctx.seat(owner)}` : undefined}
              aside={<ResourceChip resource={t.resource ?? t.printedResource} />}
              grey={!m}
              selected={selTile?.coord === t.coord}
              disabled={!ctx.live}
              onPress={m ? () => setSel(t.coord) : undefined}
            />
          );
        })}
      </div>
      {decide && leader && (
        <div className="ngr-kit">
          <span className="ngg-kicker">Your Leader</span>
          <span className="ngr-kit-row"><Token kind="hero" faction={ctx.mine?.faction ?? null} name={leader} leader state="dashed" size={20} />{leader}</span>
        </div>
      )}
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !selMove} onClick={() => selMove && ctx.send(selMove)}>
            {selTile ? `Start at site ${selTile.start} · ${selTile.label}` : 'Start here'}
          </Btn>
        </Actions>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Choice Planning: place one action card, or pass
// ---------------------------------------------------------------------------

const PLAN_CARDS: Array<{ kind: string; key: string }> = [
  { kind: 'build', key: 'build' },
  { kind: 'move_battle', key: 'moveBattle' },
  { kind: 'research', key: 'research' },
];

function Planning({ ctx }: { ctx: ScreenCtx }) {
  const { v, mine } = ctx;
  const moves = ctx.movesOf('plan_action');
  const pass = moves.find((m) => m.move['card'] === 'pass') ?? null;
  const decide = moves.length > 0;
  // Every action card this seat holds, one per copy, by the slot the engine
  // names it with (the printed card, a hero's extra, a researched extra); a
  // copy the engine lists is open, a copy already played is on the stack.
  const cards = mine
    ? PLAN_CARDS.flatMap(({ kind, key }) => {
        const held = mine.actionCards[key] ?? 0;
        const slots = mine.actionCardSlots?.[key]
          ?? Array.from({ length: held }, (_, i) => (i === 0 ? 'base' : 'hero_extra'));
        return slots.map((which) => {
          const played = mine.actionCardsPlayed?.includes(`${kind}:${which}`) ?? false;
          const move = moves.find((m) => m.move['card'] === kind && m.move['which'] === which) ?? null;
          return { kind, which, played, move };
        });
      })
    : [];
  const panel = (
    <Panel title="Place one card, or pass" kicker={`Round ${v.round} · Planning`}>
      {decide && <HowTo>Tap a card to put it on the stack.</HowTo>}
      <div className="ngr-plan-cards">
        {cards.map((c) => {
          const cls = `ngr-plan-card${c.played ? ' played' : ''}${!c.move && !c.played ? ' grey' : ''}`;
          const inner = (
            <>
              <Icon name={CARD_ICON[c.kind] ?? 'Build'} size={22} stroke={1.8} />
              <b>{CARD_NAME[c.kind]}</b>
              <i>{c.played ? 'On the stack' : c.which === 'hero_extra' ? 'Hero extra' : c.which === 'researched_extra' ? 'Researched extra' : 'In hand'}</i>
            </>
          );
          const id = `ngg-plan:${ctx.me}:${c.kind}:${c.which}`;
          return c.move
            ? <button key={id} type="button" className={cls} data-flip-id={id} disabled={!ctx.live} onClick={() => ctx.send(c.move!)}>{inner}</button>
            : <div key={id} className={cls} data-flip-id={id}>{inner}</div>;
        })}
      </div>
      {pass && (
        <Actions>
          <Btn kind="secondary" disabled={!ctx.live} onClick={() => ctx.send(pass)}>Pass for the round</Btn>
        </Actions>
      )}
      {decide && <Rule>Planning ends when everyone has passed. A pass cannot be taken back.</Rule>}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Core Reallocation: toggle platforms, send one allocations map
// ---------------------------------------------------------------------------

function CoreReallocation({ ctx }: { ctx: ScreenCtx }) {
  const { mine } = ctx;
  const moves = ctx.movesOf('reallocate_cores');
  const template = moves[0] ?? null;
  const platformIds = template && isObj(template.move['allocations']) ? Object.keys(template.move['allocations']) : [];
  // A Core sits in a map platform or, from a newer engine, in a robot
  // collector (an off-map piece until it is placed).
  const units = platformIds.map((id) => {
    const u = mine?.units.find((x) => x.id === id) ?? null;
    const c = u ? null : mine?.ownedCollectors?.find((x) => x.id === id) ?? null;
    const unit = u ?? (c ? { id, type: c.type, coord: c.placedAt, core: c.core } : null);
    return { id, unit };
  });
  const current: Record<string, boolean> = Object.fromEntries(units.map(({ id, unit }) => [id, unit?.core === 'allocated']));
  const keep = moves.find((m) => isObj(m.move['allocations']) && movesEqual(m.move['allocations'] as Record<string, unknown>, current)) ?? null;
  const [raw, setRaw] = useScratch<Record<string, boolean> | null>(ctx, 'ngg:core-reallocation', null);
  const draft: Record<string, boolean> = Object.fromEntries(platformIds.map((id) => [id, raw && typeof raw[id] === 'boolean' ? raw[id]! : current[id]!]));
  const owned = Object.values(current).filter(Boolean).length + (mine?.coresReserve ?? 0);
  const allocated = Object.values(draft).filter(Boolean).length;
  const reserve = owned - allocated;
  const changed = platformIds.some((id) => draft[id] !== current[id]);
  const decide = minePending(ctx, 'upkeep_reallocate_cores') && !!template;
  const toggle = (id: string) => {
    const next = { ...draft, [id]: !draft[id] };
    setRaw(next);
  };
  const send = () => {
    if (!template || !changed) return;
    ctx.memory.delete('ngg:core-reallocation');
    ctx.sendForm(template, { ...template.move, allocations: draft }, ['allocations']);
  };
  const panel = (
    <Panel title="Reallocate Cores" kicker="Upkeep">
      <div className="ngr-counts">
        <span><b>{owned}</b><i>CORES OWNED</i></span>
        <span><b>{reserve}</b><i>IN RESERVE</i></span>
        <span><b>{platformIds.length - allocated}</b><i>CORELESS</i></span>
      </div>
      {decide && <HowTo>Tap a platform or collector to take its Core out or put one in.</HowTo>}
      <div className="ngg-options">
        {units.map(({ id, unit }) => {
          const on = draft[id]!;
          const was = current[id]!;
          const tag = on && was ? 'HAS ONE' : !on && was ? 'CORE LEAVES' : on && !was ? 'CORE ARRIVES' : 'CORELESS';
          const canAdd = on || reserve > 0;
          return (
            <OptionRow
              key={id}
              mark={<span data-flip-id={`ngg-core:${id}`}><Token kind="unit" faction={mine?.faction ?? null} name={unit?.type ?? 'Core'} size={24} state={on ? 'solid' : 'dashed'} /></span>}
              title={unit?.type ?? id}
              sub={unit ? (unit.coord ? ctx.tile(unit.coord) : 'On the faction board') : undefined}
              aside={<span className={`ngr-core-tag${on !== was ? ' moved' : ''}`}><Icon name="Core" size={12} />{tag}</span>}
              selected={on !== was}
              disabled={!ctx.live || !canAdd}
              onPress={decide ? () => toggle(id) : undefined}
            />
          );
        })}
      </div>
      {decide && (
        <Actions>
          {keep && <Btn kind="secondary" disabled={!ctx.live} onClick={() => { ctx.memory.delete('ngg:core-reallocation'); ctx.send(keep); }}>Leave them where they are</Btn>}
          <Btn disabled={!ctx.live || !changed} onClick={send}>Move the Cores</Btn>
        </Actions>
      )}
      <Rule>Distance does not matter at upkeep. A platform with no Core stays on its tile, holds nothing, protects nothing and cannot act.</Rule>
    </Panel>
  );
  const marks: MapMarks = {
    tags: new Map(units.filter(({ id, unit }) => unit?.coord && draft[id] !== current[id]).map(({ id, unit }) => [unit!.coord!, draft[id] ? 'CORE IN' : 'CORE OUT'])),
  };
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Setup Faction: each human picks their own, in seat order; the taken ones
// are struck through with who holds them (the engine's own sentence)
// ---------------------------------------------------------------------------

function SetupFaction({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  const options = v.pending?.options ?? [];
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:setup-faction', null);
  const chosen = options.find((o) => o.id === raw && o.move) ?? null;
  const listed = chosen ? listedMove(ctx, chosen.move) : undefined;
  const decide = minePending(ctx, 'choose_faction');
  const panel = (
    <Panel title="Choose your faction" kicker="Three wizard factions, three robot factions">
      {decide && <HowTo>Tap a faction, then take it.</HowTo>}
      <div className="ngg-options">
        {options.map((o) => {
          const f = ref?.factions.find((x) => x.id === o.id) ?? null;
          return (
            <OptionRow key={o.id} mark={<FactionChip faction={o.label} size={24} />} title={o.label}
              sub={[f ? `${f.species} · ${f.color}` : null, typeof o.detail['held_by'] === 'string' ? `held by ${ctx.person(o.detail['held_by'])}` : null].filter(Boolean).join(' · ') || undefined}
              shutReason={o.blockedReason && ctx.say(o.blockedReason)}
              selected={raw === o.id} disabled={!ctx.live || !decide} onPress={() => setSel(o.id)} />
          );
        })}
      </div>
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !listed} onClick={() => { if (listed) { ctx.memory.delete('ngg:setup-faction'); ctx.send(listed); } }}>
            {chosen ? `Play ${chosen.label}` : 'Take a faction'}
          </Btn>
        </Actions>
      )}
      <Rule>No two seats share a faction.</Rule>
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Report Draw: the table's Draw button deals it; a physical seat reports it
// ---------------------------------------------------------------------------

function drawFor(ctx: ScreenCtx): string {
  const { v } = ctx;
  if (v.phase === 'setup_leaders') return 'Leader draft';
  if (v.phase === 'claims') return 'Hero claims';
  if (v.activeAction) return `${CARD_NAME[v.activeAction.cardKind]} · ${ctx.seat(v.activeAction.owner)}`;
  return `Round ${v.round}`;
}

function ReportDraw({ ctx }: { ctx: ScreenCtx }) {
  const { ref } = ctx;
  const digital = ctx.movesOf('resolve_report')[0] ?? null;
  const template = ctx.movesOf('report_draw')[0] ?? null;
  const cards = ref?.cards ?? [];
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:report-draw', null);
  const sel = cards.find((c) => c.label === raw) ?? null;
  const decide = minePending(ctx, 'report_draw');
  const send = () => {
    if (!template || !sel) return;
    ctx.memory.delete('ngg:report-draw');
    ctx.sendForm(template, { ...template.move, card: sel.label }, ['card']);
  };
  const panel = decide ? (
    <Panel title="Draw a battle card" kicker={drawFor(ctx)} tone="hl">
      {digital && <HowTo>Press Draw to take the top card of the deck.</HowTo>}
      {digital && ctx.draw && (
        <Actions>
          <Btn disabled={!ctx.live} onClick={ctx.draw}>Draw</Btn>
        </Actions>
      )}
      {template && (
        <>
          <HowTo>Tap the card you drew.</HowTo>
          <div className="ngg-cards ngr-scroll">
            {cards.map((c) => (
              <CardFace key={c.id} label={c.label} effect={c.effect} selected={sel?.id === c.id}
                disabled={!ctx.live} onPress={() => setSel(c.label)} />
            ))}
          </div>
          <Actions>
            <Btn disabled={!ctx.live || !sel} onClick={send}>{sel ? `Report ${sel.label}` : 'Report the card'}</Btn>
          </Actions>
        </>
      )}
    </Panel>
  ) : null;
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Treaty Response: an offer, answered out of turn
// ---------------------------------------------------------------------------

function TreatyResponse({ ctx }: { ctx: ScreenCtx }) {
  const moves = ctx.movesOf('respond_treaty');
  const accept = moves.find((m) => m.move['accept'] === true) ?? null;
  const decline = moves.find((m) => m.move['accept'] === false) ?? null;
  if (!ctx.route.interrupt) return <TableLayout ctx={ctx} />;
  const c = ctx.v.pending?.context ?? {};
  const proposer = typeof c['proposer'] === 'string' ? c['proposer'] : null;
  const treaty = typeof c['treaty'] === 'string' ? c['treaty'] : null;
  const income = num(c['culture_income']);
  // Who is offering, at a glance: their faction's mark and colour.
  const ink = inkOfSeat(ctx.v, proposer);
  const faction = ctx.v.players.find((p) => p.id === proposer)?.faction ?? null;
  const interrupt = (
    <Panel title={proposer && treaty ? `${ctx.seat(proposer)} offers you ${treaty}` : 'A treaty offer'} kicker="Not your turn — your answer" tone="urgent">
      {proposer && (
        <SeatBand faction={faction} name={ctx.seat(proposer)}>
          {treaty && <span className="ngr-proposer-treaty"><span style={{ color: TREATY_INK[treaty] ?? 'inherit' }}><Icon name={treaty} size={18} /></span>{treaty}</span>}
        </SeatBand>
      )}
      {income !== null && <p className="ngr-state">+{income} culture to each of you, every round it stands</p>}
      {typeof c['effect'] === 'string' && <Rule>{c['effect']}</Rule>}
      {typeof c['break_condition'] === 'string' && <Rule>To break it: {c['break_condition']}</Rule>}
      <HowTo>The table waits on your answer.</HowTo>
      <Actions>
        {decline && <Btn kind="secondary" disabled={!ctx.live} onClick={() => ctx.send(decline)}><span className="ngr-ic"><Icon name="Decline" size={14} /></span>Decline</Btn>}
        {accept && <Btn disabled={!ctx.live} onClick={() => ctx.send(accept)}><span className="ngr-ic"><Icon name="Accept" size={14} /></span>{treaty ? `Accept ${treaty}` : 'Accept'}</Btn>}
      </Actions>
    </Panel>
  );
  return <TableLayout ctx={ctx} interrupt={interrupt} />;
}

// ---------------------------------------------------------------------------
// Treaty Break: break as many as are open, then Done
// ---------------------------------------------------------------------------

function TreatyLine({ ctx, name, partners, income }: { ctx: ScreenCtx; name: string; partners: [string, string]; income: number }) {
  const { v } = ctx;
  return (
    <li className="ngr-treaty" data-flip-id={`ngg-treaty:${name}:${[...partners].sort().join('+')}`}>
      <span className="ngr-treaty-mark" style={{ color: TREATY_INK[name] ?? 'inherit' }}><Icon name={name} size={16} /></span>
      <span className="ngr-treaty-pair">
        <FactionChip faction={v.players.find((p) => p.id === partners[0])?.faction ?? null} size={16} />
        <FactionChip faction={v.players.find((p) => p.id === partners[1])?.faction ?? null} size={16} />
      </span>
      <span className="ngr-treaty-name">{name}<i>{ctx.seat(partners[0])} · {ctx.seat(partners[1])}</i></span>
      <span className="ngr-income">+{income}</span>
    </li>
  );
}

function TreatyBreak({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const pending = v.pending?.kind === 'treaty_break_decision' ? v.pending : null;
  const options = pending?.options ?? [];
  const keepOpt = options.find((o) => o.id === 'keep') ?? null;
  const treatyOpts = options.filter((o) => o.id !== 'keep');
  const keep = listedMove(ctx, keepOpt?.move) ?? (pending?.options ? undefined : ctx.movesOf('skip_action')[0]);
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:treaty-break', null);
  const sel = treatyOpts.find((o) => o.id === raw && listedMove(ctx, o.move)) ?? null;
  const selMove = sel ? listedMove(ctx, sel.move) : undefined;
  const decide = pending?.for === ctx.me;
  const owner = pending?.for ?? null;
  const others = v.treaties.filter((t) => !owner || !t.partners.includes(owner));
  const panel = (
    <Panel title={decide ? 'Your treaties' : `${ctx.seat(owner)}'s treaties`} kicker="Break as many as are open">
      {decide && <HowTo>Break as many as are open, then Done.</HowTo>}
      <div className="ngg-options">
        {treatyOpts.map((o) => {
          const move = listedMove(ctx, o.move);
          const cond = str(o.detail['break_condition']);
          const income = num(o.detail['culture_income']);
          return (
            <OptionRow
              key={o.id}
              title={o.label}
              sub={cond ? `To break: ${cond}` : undefined}
              aside={<>{income !== null && <span className="ngr-income">+{income}</span>}{move && !o.blockedReason && <span className="ngr-open">CAN BREAK</span>}</>}
              shutReason={o.blockedReason && ctx.say(o.blockedReason)}
              selected={sel?.id === o.id}
              disabled={!ctx.live}
              onPress={move ? () => setSel(o.id) : undefined}
            />
          );
        })}
        {treatyOpts.length === 0 && <HowTo>No treaties left to break.</HowTo>}
      </div>
      {decide && (
        <Actions>
          {keep && <Btn kind="secondary" disabled={!ctx.live} onClick={() => { ctx.memory.delete('ngg:treaty-break'); ctx.send(keep); }}>Keep</Btn>}
          <Btn disabled={!ctx.live || !selMove} onClick={() => { if (selMove) { ctx.memory.delete('ngg:treaty-break'); ctx.send(selMove); } }}>
            {sel ? `Break ${str(sel.move?.['treaty_type']) || sel.label}` : 'Break a treaty'}
          </Btn>
        </Actions>
      )}
      <Rule>Each break takes that token back and stops its culture at the next income step.</Rule>
      {others.length > 0 && (
        <>
          <div className="ngg-kicker">On the table, not {decide ? 'yours' : 'theirs'} to break</div>
          <ul className="ngr-treaties">
            {others.map((t) => <TreatyLine key={`${t.name}:${t.partners.join('+')}`} ctx={ctx} name={t.name} partners={t.partners} income={t.cultureIncome} />)}
          </ul>
        </>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Hero Claim: one hero from the shared pool
// ---------------------------------------------------------------------------

function HeroClaim({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref, mine } = ctx;
  const moves = ctx.movesOf('choose_milestone_hero');
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:hero-claim', null);
  const sel = moves.find((m) => str(m.move['hero']) === raw) ?? null;
  const decide = minePending(ctx, 'choose_milestone_hero');
  const panel = (
    <Panel title="Claim a hero" kicker={`The shared pool · ${v.heroPoolCount} in pool`}>
      {decide && mine && (
        <p className="ngr-state">Culture {mine.culture}{mine.nextMilestones.length > 0 ? ` · next milestone ${mine.nextMilestones[0]}` : ''}</p>
      )}
      {decide && moves.length > 0 && <HowTo>Tap a hero, then claim them.</HowTo>}
      {moves.length > 0 && (
        <div className="ngg-options ngr-scroll">
          {moves.map((m) => {
            const name = str(m.move['hero']);
            return <HeroOption key={name} ctx={ctx} name={name} hero={heroByName(ref, name)} selected={sel === m} onPress={() => setSel(name)} />;
          })}
        </div>
      )}
      {decide && mine && mine.bases.length === 0 && <Rule>No base: the hero is reserved, with no benefits until placed.</Rule>}
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !sel} onClick={() => { if (sel) { ctx.memory.delete('ngg:hero-claim'); ctx.send(sel); } }}>
            {sel ? `Claim ${str(sel.move['hero'])}` : 'Claim a hero'}
          </Btn>
        </Actions>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Reserved Hero: place it on one of your bases
// ---------------------------------------------------------------------------

function ReservedHero({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  const moves = ctx.movesOf('place_reserved_hero');
  const hero = moves.length > 0 ? str(moves[0]!.move['hero']) : null;
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:reserved-hero', null);
  const sel = moves.find((m) => str(m.move['coord']) === raw) ?? null;
  const decide = minePending(ctx, 'place_reserved_hero');
  const printed = hero ? heroByName(ref, hero) : null;
  const marks: MapMarks = decide ? {
    lit: new Set(moves.map((m) => str(m.move['coord']))),
    greyRest: true,
    selected: sel ? str(sel.move['coord']) : null,
    onTile: ctx.live ? (coord) => setSel(coord) : undefined,
    proposals: sel && hero ? [{ coord: str(sel.move['coord']), owner: ctx.me ?? '', kind: 'hero', name: hero, key: 'reserved-hero' }] : [],
  } : {};
  const panel = (
    <Panel title="Place a reserved hero">
      {decide && hero && (
        <>
          <p className="ngr-state">{hero} is owed a place.</p>
          {printed?.effect && <p className="ngr-effect">{printed.effect}</p>}
          <HowTo>Tap one of your bases.</HowTo>
          <div className="ngg-options">
            {moves.map((m) => {
              const coord = str(m.move['coord']);
              return (
                <OptionRow key={coord} mark={<Token kind="base" faction={ctx.mine?.faction ?? null} name="Base" size={22} />}
                  title={ctx.tile(coord)} aside={<ResourceChip resource={v.tiles.find((t) => t.coord === coord)?.resource ?? null} />}
                  selected={sel === m} disabled={!ctx.live} onPress={() => setSel(coord)} />
              );
            })}
          </div>
        </>
      )}
      {decide && v.reservedHeroes.length > 1 && (
        <div className="ngr-kit">
          <span className="ngg-kicker">Reserved</span>
          {v.reservedHeroes.map((h) => <span key={h} className="ngr-kit-row"><Token kind="hero" faction={ctx.mine?.faction ?? null} name={h} state="dashed" size={20} />{h}</span>)}
        </div>
      )}
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !sel} onClick={() => { if (sel) { ctx.memory.delete('ngg:reserved-hero'); ctx.send(sel); } }}>
            {sel && hero ? `Place ${hero} on ${ctx.tile(str(sel.move['coord']))}` : 'Place the hero'}
          </Btn>
        </Actions>
      )}
      {decide && <Rule>A claimed hero goes to any base you own. Nothing is paid back for rounds reserved.</Rule>}
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Dowser's free collector (ruling #106): a robot picks which collector type
// Dowser Wren Calloway grants, a Core already in it. One engine move per type.
// ---------------------------------------------------------------------------

function DowserCollector({ ctx }: { ctx: ScreenCtx }) {
  const moves = ctx.movesOf('choose_dowser_collector');
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:dowser-collector', null);
  const sel = moves.find((m) => str(m.move['collector']) === raw) ?? null;
  const decide = minePending(ctx, 'dowser_collector');
  const owner = ctx.v.pending?.for ?? null;
  const faction = ctx.v.players.find((p) => p.id === owner)?.faction ?? null;
  // Ruling #117: a robot takes four free collectors, picked one at a time; the engine says how many are left.
  const left = num(ctx.v.pending?.context['remaining']);
  const panel = (
    <Panel kicker={left !== null ? `${left} left to pick` : undefined}
      title={decide ? 'Dowser gives you free collectors' : `${owner ? ctx.seat(owner) : 'A seat'} takes free collectors from Dowser`}>
      {decide && <HowTo>Pick the type of each, one at a time. Each comes with a Core already in it.</HowTo>}
      <div className="ngg-options">
        {moves.map((m) => {
          const name = str(m.move['collector']);
          const unit = itemByName(ctx.ref, name);
          const res = unit?.kind === 'unit' ? unit.unit.collectorResource : null;
          return (
            <OptionRow
              key={name}
              mark={<Token kind="collector" faction={faction} name={res ? name : 'Collector'} size={26} />}
              title={name}
              sub={res ? <span className="ngr-effect">Collects <ResourceChip resource={res} /></span> : undefined}
              selected={sel === m}
              disabled={!ctx.live}
              onPress={() => setSel(name)}
            />
          );
        })}
      </div>
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !sel} onClick={() => { if (sel) { ctx.memory.delete('ngg:dowser-collector'); ctx.send(sel); } }}>
            {sel ? `Take the ${str(sel.move['collector'])}` : 'Choose a collector'}
          </Btn>
        </Actions>
      )}
      <Rule>It counts toward its type's limit and toward technology like any other collector.</Rule>
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Overlay Choice: which Economy hero's overlay is active
// ---------------------------------------------------------------------------

function OverlayChoice({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  const moves = ctx.movesOf('resolve_overlay_choice');
  const names = moves.map((m) => str(m.move['hero']));
  // The tile both heroes stand on, from the owners' own hero lists.
  const tile = v.tiles.find((t) => names.length > 0 && names.every((n) => t.pieces.some((p) => p.kind === 'hero' && p.name === n))) ?? null;
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:overlay-choice', null);
  const sel = moves.find((m) => str(m.move['hero']) === raw) ?? null;
  const decide = minePending(ctx, 'overlay_choice');
  const marks: MapMarks = tile ? { origin: tile.coord, greyRest: true } : {};
  const panel = (
    <Panel title={tile ? `Two Economy heroes are standing on ${tile.label}` : 'Choose the overlay'}>
      {tile && (
        <p className="ngr-state">Printed <ResourceChip resource={tile.printedResource} /> · now <ResourceChip resource={tile.resource} /></p>
      )}
      {decide && <HowTo>Tap the overlay to make active.</HowTo>}
      <div className="ngg-options">
        {moves.map((m) => {
          const name = str(m.move['hero']);
          const owner = v.players.find((p) => p.heroes.some((h) => h.name === name)) ?? null;
          const printed = heroByName(ref, name);
          const option = v.pending?.options?.find((o) => o.label === name) ?? null;
          const makes = option && typeof option.detail['resource'] === 'string' ? option.detail['resource'] : null;
          return (
            <div key={name} data-flip-id={`ngg-hero-card:${name}`}>
              <OptionRow
                mark={<Token kind="hero" faction={owner?.faction ?? null} name={name} size={26} />}
                title={name}
                sub={<>{owner && <span className="ngr-hero-cat">{ctx.seat(owner.id)}</span>}{printed?.effect && <span className="ngr-effect">{printed.effect}</span>}</>}
                aside={makes ? <ResourceChip resource={makes} /> : undefined}
                selected={sel === m}
                disabled={!ctx.live}
                onPress={() => setSel(name)}
              />
            </div>
          );
        })}
      </div>
      {decide && (
        <Actions>
          <Btn disabled={!ctx.live || !sel} onClick={() => { if (sel) { ctx.memory.delete('ngg:overlay-choice'); ctx.send(sel); } }}>
            {sel ? `Make ${str(sel.move['hero'])}'s overlay active` : 'Choose an overlay'}
          </Btn>
        </Actions>
      )}
      <Rule>Only one may be active, and the choice is locked until one of them walks away.</Rule>
    </Panel>
  );
  return <TableLayout ctx={ctx} marks={marks} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Spy Assign: which of your heroes carries the spy (seat-private)
// ---------------------------------------------------------------------------

function SpyAssign({ ctx }: { ctx: ScreenCtx }) {
  const { mine, ref } = ctx;
  const moves = ctx.movesOf('choose_spy');
  const [raw, setSel] = useScratch<string | null>(ctx, 'ngg:spy-assign', null);
  const sel = moves.find((m) => str(m.move['hero']) === raw) ?? null;
  const decide = minePending(ctx, 'choose_spy');
  const panel = decide ? (
    <Panel title="Which hero carries it" kicker="Only you see this" tone="hl">
      {ctx.v.pending?.context['source'] === 'illusionist' && <Rule>An Illusionist's spy: its carrier may reveal it for a Decoy, or for Invisible once researched.</Rule>}
      {ctx.v.pending?.context['source'] === 'infiltrator' && <Rule>An Infiltrator's spy: its carrier may reveal it for a Spy Attack, or to look at an opposing spy card.</Rule>}
      <HowTo>Tap a hero, then assign the spy.</HowTo>
      <div className="ngg-options">
        {moves.map((m) => {
          const name = str(m.move['hero']);
          const h = mine?.heroes.find((x) => x.name === name) ?? null;
          const where = h?.coord ? ctx.tile(h.coord) : 'reserved';
          return (
            <HeroOption key={name} ctx={ctx} name={name} hero={heroByName(ref, name)} stats={h?.stats}
              aside={<span className="ngr-where">{where}</span>} selected={sel === m} onPress={() => setSel(name)} />
          );
        })}
      </div>
      <Actions>
        <Btn disabled={!ctx.live || !sel} onClick={() => { if (sel) { ctx.memory.delete('ngg:spy-assign'); ctx.send(sel); } }}>
          {sel ? `Assign to ${str(sel.move['hero'])}` : 'Assign the spy'}
        </Btn>
      </Actions>
      <Rule>Purchases are public. Carriers are not. Revealing spends the assignment.</Rule>
    </Panel>
  ) : null;
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// The End: standings from victory_status, and the result
// ---------------------------------------------------------------------------

function GameOver({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const winners = isObj(v.result) && Array.isArray(v.result['winners']) ? v.result['winners'].filter((w): w is string => typeof w === 'string') : [];
  const ordered = [...v.players.filter((p) => winners.includes(p.id)), ...v.players.filter((p) => !winners.includes(p.id))];
  const kinds = isObj(v.result) && Array.isArray(v.result['kinds']) ? v.result['kinds'].filter((k): k is string => typeof k === 'string') : [];
  const how = kinds.length > 0 ? ` — ${kinds.map((k) => `${k.toLowerCase()} victory`).join(' and ')}` : '';
  const line = (winners.length === 0 ? 'The game is over'
    : winners.length === 1 ? `${ctx.seat(winners[0])} wins`
      : `${winners.slice(0, -1).map((w) => ctx.seat(w)).join(', ')} and ${ctx.seat(winners[winners.length - 1])} win`) + how;
  const panel = (
    <Panel title="The end" tone="hl">
      <p className="ngr-winner">{line}</p>
      <ul className="ngr-standings">
        {ordered.map((p) => {
          const vs = v.victory[p.id];
          const won = winners.includes(p.id);
          return (
            <li key={p.id} className={won ? 'won' : ''} data-flip-id={`ngg-standing:${p.id}`}>
              <FactionChip faction={p.faction} size={24} />
              <span className="ngr-standing-name">
                <b>{ctx.seat(p.id)}{p.id === ctx.me ? ' · you' : ''}</b>
                <i>
                  {[
                    `culture ${vs?.culture ?? p.culture}`,
                    `tech ${vs?.tech ?? p.tech.total}${p.tech.target !== null ? ` of ${p.tech.target}` : ''}`,
                    `Leader kills ${vs?.leaderKills ?? p.leaderKills}${p.militaryKillsNeeded ? ` of ${p.militaryKillsNeeded}` : ''}`,
                  ].join(' · ')}
                </i>
              </span>
              {won && <span className="ngr-won">WINNER</span>}
              {!(vs?.leaderAlive ?? p.leaderAlive) && <span className="ngr-dead">LEADER DEAD</span>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// The no-decision routes: the table, with the phase named
// ---------------------------------------------------------------------------

const QUIET_TITLES: Partial<Record<ScreenKey, string>> = { upkeep: 'Upkeep', culture: 'Culture income', 'end-of-round': 'End of round' };

function QuietTable({ ctx }: { ctx: ScreenCtx }) {
  const title = QUIET_TITLES[ctx.route.screen];
  const panel = title ? <Panel title={title} kicker={`Round ${ctx.v.round}`}><HowTo>Nothing to decide here.</HowTo></Panel> : null;
  return <TableLayout ctx={ctx} panel={panel} />;
}

// ---------------------------------------------------------------------------
// Diplomacy: standing treaties, your tokens, and the Treaty Offer composer.
// Mounted by whichever screen is up while this seat holds form_treaty moves.
// ---------------------------------------------------------------------------

interface OfferDraft { open: boolean; partner: string | null; type: string | null }

export function DiplomacyPanel({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref, me } = ctx;
  const offers = ctx.movesOf('form_treaty');
  const [draft, setDraft] = useScratch<OfferDraft>(ctx, 'ngg:treaty-offer', { open: false, partner: null, type: null });
  if (offers.length === 0) return null;
  const partners = [...new Set(offers.map((m) => str(m.move['partner'])))];
  const partner = draft.partner && partners.includes(draft.partner) ? draft.partner : null;
  const types = partner ? offers.filter((m) => m.move['partner'] === partner) : [];
  const chosen = types.find((m) => m.move['treaty_type'] === draft.type) ?? null;
  const mineTreaties = v.treaties.filter((t) => me && t.partners.includes(me));
  const send = () => {
    if (!chosen) return;
    ctx.memory.delete('ngg:treaty-offer');
    ctx.send(chosen);
  };
  return (
    <Panel title="Diplomacy" kicker="Treaties">
      {v.treaties.length > 0 && (
        <>
          <div className="ngg-kicker">Standing treaties</div>
          <ul className="ngr-treaties">
            {v.treaties.map((t) => <TreatyLine key={`${t.name}:${t.partners.join('+')}`} ctx={ctx} name={t.name} partners={t.partners} income={t.cultureIncome} />)}
          </ul>
        </>
      )}
      {ref && ref.treaties.length > 0 && (
        <>
          <div className="ngg-kicker">Your tokens · one of each kind</div>
          <div className="ngr-tokens">
            {ref.treaties.map((t) => {
              const held = mineTreaties.find((x) => x.name === t.name);
              const partnerOf = held ? held.partners.find((p) => p !== me) ?? null : null;
              return (
                <span key={t.id} className={`ngr-token${held ? ' out' : ''}`} data-flip-id={`ngg-treaty-token:${me}:${t.id}`}>
                  <span style={{ color: TREATY_INK[t.name] ?? 'inherit' }}><Icon name={t.name} size={14} /></span>
                  <b>{t.name}</b>
                  <i>{partnerOf ? `with ${ctx.seat(partnerOf)}` : 'free'}</i>
                </span>
              );
            })}
          </div>
        </>
      )}
      {!draft.open ? (
        <Actions>
          <Btn kind="secondary" disabled={!ctx.live} onClick={() => setDraft({ open: true, partner: null, type: null })}>
            <span className="ngr-ic"><Icon name="Offer a treaty" size={14} /></span>Offer a treaty
          </Btn>
        </Actions>
      ) : (
        <div className="ngr-offer">
          <div className="ngg-kicker">Offer a treaty · to</div>
          <div className="ngr-partners">
            {partners.map((pid) => (
              <button key={pid} type="button" className={`ngr-partner${partner === pid ? ' on' : ''}`} aria-pressed={partner === pid}
                disabled={!ctx.live} onClick={() => setDraft({ open: true, partner: pid, type: null })}>
                <FactionChip faction={v.players.find((p) => p.id === pid)?.faction ?? null} size={18} />
                {ctx.seat(pid)}
              </button>
            ))}
          </div>
          {partner && (
            <div className="ngg-options">
              {types.map((m) => {
                const name = str(m.move['treaty_type']);
                const printed = treatyByName(ref, name);
                return (
                  <OptionRow
                    key={name}
                    mark={<span style={{ color: TREATY_INK[name] ?? 'inherit' }}><Icon name={name} size={18} /></span>}
                    title={name}
                    sub={printed ? <><span className="ngr-effect">{printed.effect}</span><span className="ngr-hero-cat">To break it: {printed.breakingCondition}</span></> : undefined}
                    aside={printed ? <span className="ngr-income">+{printed.cultureIncome} EACH</span> : undefined}
                    selected={chosen === m}
                    disabled={!ctx.live}
                    onPress={() => setDraft({ open: true, partner, type: name })}
                  />
                );
              })}
            </div>
          )}
          <Rule>Both of you must agree and exchange tokens.</Rule>
          <Actions>
            <Btn kind="quiet" onClick={() => { ctx.memory.delete('ngg:treaty-offer'); setDraft({ open: false, partner: null, type: null }); }}>Cancel</Btn>
            <Btn disabled={!ctx.live || !chosen} onClick={send}>
              {chosen && partner ? `Offer ${str(chosen.move['treaty_type'])} to ${ctx.seat(partner)}` : 'Send the offer'}
            </Btn>
          </Actions>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Action Done: the action's effects are over; offer a treaty, or end the turn
// ---------------------------------------------------------------------------

const ACTION_NAMES: Record<string, string> = { build: 'Build', research: 'Research', move_battle: 'Move/Battle' };

function ActionDone({ ctx }: { ctx: ScreenCtx }) {
  const kind = ctx.v.activeAction?.cardKind ?? 'build';
  const name = ACTION_NAMES[kind] ?? kind;
  const end = ctx.movesOf('skip_action')[0] ?? null;
  const mine = ctx.route.perspective === 'decide';
  const panel = (
    <Panel title={mine ? `Your ${name} action is done` : `${ctx.seat(ctx.route.owner)}'s ${name} action is done`} kicker="End of the action">
      {mine && <HowTo>{ctx.movesOf('form_treaty').length > 0 ? 'Offer a treaty now, or end the action.' : 'End the action.'}</HowTo>}
      {mine && end && (
        <Actions>
          <Btn disabled={!ctx.live} onClick={() => ctx.send(end)}>End action</Btn>
        </Actions>
      )}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={<>{panel}{mine && <DiplomacyPanel ctx={ctx} />}</>} />;
}

export const ROUND_SCREENS: Partial<Record<ScreenKey, ComponentType<{ ctx: ScreenCtx }>>> = {
  'action-done': ActionDone,
  'setup-table': SetupTable,
  'setup-faction': SetupFaction,
  'setup-draft': SetupDraft,
  'setup-start': SetupStart,
  planning: Planning,
  'core-reallocation': CoreReallocation,
  'report-draw': ReportDraw,
  'treaty-response': TreatyResponse,
  'treaty-break': TreatyBreak,
  'hero-claim': HeroClaim,
  'reserved-hero': ReservedHero,
  'overlay-choice': OverlayChoice,
  'dowser-collector': DowserCollector,
  'spy-assign': SpyAssign,
  'game-over': GameOver,
  upkeep: QuietTable,
  culture: QuietTable,
  'end-of-round': QuietTable,
  table: QuietTable,
};
