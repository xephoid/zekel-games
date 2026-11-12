// The table every NGnG screen renders inside: the map with the action stack
// floating over it, the decision in the right-hand column above the seats and
// the culture race, and the seat's own faction board folded into a strip
// along the bottom. These regions are ambient (SCREEN-ROUTING §7): they are
// never routed to, and they change underneath whatever decision is open.

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ScreenCtx } from './ctx.js';
import { HexMap, type MapMarks } from './HexMap.js';
import { TREATY_INK, inkOf, inkOfSeat, initials } from './factions.js';
import { WAITING_ON } from './route.js';
import { CardBack, FactionChip, HeroFacts, HeroName, Icon, Panel, SpyMark } from './ui.js';
import { cultureRaceOf, economicCollectorsFor } from './ref.js';
import { econOf, type NggPlayer } from './read.js';
import { FactionBoard, FactionStrip } from './FactionBoard.js';

const CARD_ICON: Record<string, string> = { build: 'Build', research: 'Research', move_battle: 'Move / Battle' };
const CARD_NAME: Record<string, string> = { build: 'Build', research: 'Research', move_battle: 'Move / Battle' };

function ActionStack({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  if (v.stack.length === 0) return null;
  const top = v.stack[v.stack.length - 1];
  const resolving = v.activeAction && top && top.owner === v.activeAction.owner ? top.position : null;
  return (
    <div className="ngg-float ngg-stack" aria-label="Action stack">
      <div className="ngg-float-title">Action stack</div>
      <ol className="ngg-stack-rows">
        {[...v.stack].reverse().map((a) => {
          const ink = inkOfSeat(v, a.owner);
          const now = a.position === resolving;
          return (
            <li key={a.position} className={`ngg-stack-row${now ? ' now' : ''}`} data-flip-id={`ngg-stack:${a.position}:${a.owner}`}>
              <span className="ngg-dot" style={{ background: ink.fill }} title={ctx.seat(a.owner)} />
              {a.cardKind
                ? <><span className="ngg-stack-mark"><Icon name={CARD_ICON[a.cardKind] ?? 'Build'} size={15} stroke={1.8} /></span><span className="ngg-stack-name">{CARD_NAME[a.cardKind] ?? a.cardKind}</span></>
                : <><CardBack /><span className="ngg-stack-name muted">Face down</span></>}
              {now && <span className="ngg-tag">NOW</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Pills({ ctx }: { ctx: ScreenCtx }) {
  const { v } = ctx;
  const first = inkOfSeat(v, v.firstPlayerId);
  return (
    <div className="ngg-pills">
      {v.firstPlayerId && (
        <span className="ngg-pill"><span className="ngg-dot" style={{ background: first.fill }} />First player · {ctx.seat(v.firstPlayerId)}</span>
      )}
      <span className="ngg-pill">{v.tiles.length} tiles</span>
    </div>
  );
}

/** Every standing treaty: who holds it with whom, and what it pays. */
function TreatiesSheet({ ctx, onClose }: { ctx: ScreenCtx; onClose: () => void }) {
  const { v } = ctx;
  const factionOf = (pid: string) => v.players.find((p) => p.id === pid)?.faction ?? null;
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet ngg-treaties-sheet ngg-side" role="dialog" aria-label="Treaties" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn secondary small close" onClick={onClose} aria-label="Close the treaties">✕</button>
        <h2>Treaties</h2>
        {v.treaties.length === 0
          ? <p className="muted">No treaties stand at this table.</p>
          : (
            <ul className="ngg-treaty-pairs">
              {v.treaties.map((t) => (
                <li key={`${t.name}:${[...t.partners].sort().join('+')}`}>
                  <span className="ngg-treaty-side"><FactionChip faction={factionOf(t.partners[0])} size={22} /><b>{ctx.seat(t.partners[0])}</b></span>
                  <span className="ngg-treaty-kind">
                    <span style={{ color: TREATY_INK[t.name] ?? 'inherit' }}><Icon name={t.name} size={16} /></span>
                    {t.name}
                    <i>+{t.cultureIncome} culture each a round</i>
                  </span>
                  <span className="ngg-treaty-side"><FactionChip faction={factionOf(t.partners[1])} size={22} /><b>{ctx.seat(t.partners[1])}</b></span>
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}

/** Every hero in the game: its printed ability, and who holds it (as Leader,
 *  held, reserved or killed) or that it is still in the pool. A hero leaves the
 *  pool only when a seat takes it, so one no seat lists is in the pool; the
 *  engine's pool count must agree, else the screen does not claim it. */
function HeroesSheet({ ctx, onClose }: { ctx: ScreenCtx; onClose: () => void }) {
  const { v, ref } = ctx;
  const heroes = [...(ref?.heroes ?? [])].sort((a, b) => a.num - b.num);
  const holder = new Map<string, { owner: string; leader: boolean; dead: boolean; reserved: boolean }>();
  for (const p of v.players) for (const h of p.heroes) holder.set(h.name, { owner: p.id, leader: h.leader, dead: h.dead, reserved: h.coord === null && !h.dead });
  const unheld = heroes.filter((h) => !holder.has(h.name)).length;
  const poolKnown = unheld === v.heroPoolCount;
  // One line of printed text each; a row opens to the whole text.
  const [open, setOpen] = useState<string | null>(null);
  const statsOf = (name: string) => v.players.flatMap((p) => p.heroes).find((x) => x.name === name)?.stats ?? null;
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <div className="sheet ngg-heroes-sheet ngg-side" role="dialog" aria-label="Heroes" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn secondary small close" onClick={onClose} aria-label="Close the heroes">✕</button>
        <h2>Heroes</h2>
        <p className="muted">{v.heroPoolCount} in the pool · {heroes.length - unheld} taken</p>
        <ul className="ngg-hero-list">
          {heroes.map((h) => {
            const held = holder.get(h.name);
            const ink = held ? inkOfSeat(v, held.owner) : null;
            const status = held
              ? `${held.dead ? 'Killed' : held.leader ? 'Leader' : held.reserved ? 'Reserved' : 'Held'} · ${ctx.seat(held.owner)}`
              : poolKnown ? 'In the pool' : 'Not held';
            return (
              <li key={h.id} className={`${held ? 'taken' : 'free'}${held?.dead ? ' dead' : ''}${open === h.id ? ' open' : ''}`}
                role="button" tabIndex={0} aria-expanded={open === h.id}
                onClick={() => setOpen(open === h.id ? null : h.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(open === h.id ? null : h.id); } }}>
                <span className="ngg-avatar" style={ink ? { background: ink.fill, color: ink.on } : undefined}>
                  {initials(h.name)}
                </span>
                <span className="ngg-hero-body">
                  <b><HeroName hero={h} name={h.name} /></b>
                  {/* A held hero's stats as the engine reads them now (a Leader's
                      +DEF included); any other its printed ones. */}
                  <HeroFacts hero={h} liveStats={held && !held.dead ? statsOf(h.name) : null} open={open === h.id} />
                </span>
                <span className="ngg-hero-status">
                  {held && <FactionChip faction={v.players.find((p) => p.id === held.owner)?.faction ?? null} size={18} />}
                  {status}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function SeatsPanel({ ctx, onOpen }: { ctx: ScreenCtx; onOpen: (playerId: string) => void }) {
  const { v } = ctx;
  const [treatiesOpen, setTreatiesOpen] = useState(false);
  const [heroesOpen, setHeroesOpen] = useState(false);
  return (
    <Panel title="Seats">
      <ul className="ngg-seats">
        {v.players.map((p) => {
          const you = p.id === ctx.me;
          const deciding = v.pending ? v.pending.for === p.id : v.activePlayerId === p.id;
          return (
            <li key={p.id}>
              <button type="button" data-view-only className={`ngg-seat${you ? ' you' : ''}${deciding ? ' deciding' : ''}`}
                onClick={() => onOpen(p.id)} aria-label={`Open ${you ? 'your' : `${ctx.seat(p.id)}'s`} faction board`}>
              {/* A seat's supply (where its new pieces fly from) is marked once: the
                  viewer's on their own strip below, every other seat's here. Two
                  elements under one id would slide toward each other on every move. */}
              <span data-flip-id={p.id === ctx.me ? undefined : `ngg-supply:${p.id}`}><FactionChip faction={p.faction} size={24} /></span>
              <span className="ngg-seat-name">
                <span>{ctx.seat(p.id)}<SpyMark species={p.species} count={p.unrevealedSpies ?? 0} /></span>
                <span className="ngg-seat-detail">{[you ? 'you' : null, p.species, `${p.bases.length} base${p.bases.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="ngg-stat"><b>{p.culture}</b><i>CULT</i></span>
              <span className="ngg-stat"><b>{p.tech.total}{p.tech.target !== null ? `/${p.tech.target}` : ''}</b><i>TECH</i></span>
              <EconStat ctx={ctx} p={p} />
              <span className="ngg-stat" title={`Leader kills: ${p.leaderKills} of the ${p.militaryKillsNeeded} a Military victory needs`}>
                <b>{p.leaderKills}{p.militaryKillsNeeded ? `/${p.militaryKillsNeeded}` : ''}</b><i>KILLS</i>
              </span>
              <span className="ngg-stat"><b className={p.leaderAlive ? 'ok' : 'dead'}>{p.leaderAlive ? '✓' : '✕'}</b><i>LEAD</i></span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="ngg-seats-foot">
        <button type="button" data-view-only className="ngg-link" onClick={() => setHeroesOpen(true)}>Heroes</button>
        <button type="button" data-view-only className="ngg-link" onClick={() => setTreatiesOpen(true)}>
          Treaties{v.treaties.length > 0 ? ` (${v.treaties.length})` : ''}
        </button>
      </div>
      {treatiesOpen && <TreatiesSheet ctx={ctx} onClose={() => setTreatiesOpen(false)} />}
      {heroesOpen && <HeroesSheet ctx={ctx} onClose={() => setHeroesOpen(false)} />}
    </Panel>
  );
}

/** Economic progress: collectors owned against the number the Economic spend
 *  takes on this map (as many collectors on as many different tiles). */
function EconStat({ ctx, p }: { ctx: ScreenCtx; p: NggPlayer }) {
  const econ = econOf(p);
  const need = economicCollectorsFor(ctx.ref, ctx.v.layout);
  const title = econ
    ? `${econ.owned} collector${econ.owned === 1 ? '' : 's'} owned${econ.unpowered ? ` (${econ.unpowered} without a Core)` : ''}${need ? `; the Economic victory spends ${need} on ${need} different tiles` : ''}`
    : 'Collector count not published by this engine';
  return (
    <span className="ngg-stat" title={title}>
      <b>{econ ? econ.owned : '—'}{need ? `/${need}` : ''}</b><i>ECON</i>
    </span>
  );
}

function CultureRace({ ctx }: { ctx: ScreenCtx }) {
  const { v, ref } = ctx;
  // The target and milestones scale with the number of players.
  const { target, milestones } = cultureRaceOf(ref, v.players.length, v.players.find((p) => p.cultureTarget !== null)?.cultureTarget ?? null);
  const marks = [...milestones, target];
  const lanes = [...v.players].sort((a, b) => b.culture - a.culture);
  const pct = (n: number) => `${Math.min(100, (n / target) * 100)}%`;
  return (
    <Panel title="Culture" kicker={`${target} wins · a hero at each flag`}>
      <div className="ngg-race">
        <div className="ngg-race-axis">
          {marks.map((m) => <span key={m} style={{ left: pct(m) }}><i />{m}</span>)}
        </div>
        {lanes.map((p) => {
          const ink = inkOf(p.faction);
          return (
            <div key={p.id} className="ngg-race-lane" title={`${ctx.seat(p.id)} · ${p.culture}`}>
              <span className="ngg-race-fill" style={{ width: pct(p.culture), background: ink.fill }} />
              <span className="ngg-race-marker" style={{ left: pct(p.culture), background: ink.fill, color: ink.on }}>{p.culture}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** The line a seat reads while another seat owes the decision: who, and what kind. */
export function WaitingLine({ ctx }: { ctx: ScreenCtx }) {
  const { v, route } = ctx;
  if (route.perspective !== 'watch' || !route.owner) return null;
  const doing = v.pending ? WAITING_ON[v.pending.kind] : null;
  return (
    <div className="ngg-waiting" aria-live="polite">
      <FactionChip faction={v.players.find((p) => p.id === route.owner)?.faction ?? null} size={18} />
      <span>Waiting on {ctx.seat(route.owner)}{doing ? ` — ${doing}` : ''}</span>
    </div>
  );
}

export function TableLayout({ ctx, marks, panel, interrupt }: {
  ctx: ScreenCtx;
  marks?: MapMarks;
  /** the decision: what this screen asks, its options, its buttons */
  panel?: ReactNode;
  /** an out-of-turn decision drawn above everything, leaving the rest in place */
  interrupt?: ReactNode;
}) {
  // Whose faction board is open: the seat's own, or any other seat's.
  const [boardFor, setBoardFor] = useState<string | null>(null);
  const boardPlayer = boardFor ? ctx.v.players.find((p) => p.id === boardFor) ?? null : null;
  const species = ctx.mine?.species ?? null;
  return (
    <div className={`ngg-root${species ? ` seat-${species}` : ''}`}>
      <div className="ngg-main">
        <div className="ngg-board">
          <HexMap v={ctx.v} marks={marks} seatSpecies={species} refs={ctx.ref} overlay={<><ActionStack ctx={ctx} /><Pills ctx={ctx} /></>} />
        </div>
        <div className="ngg-column">
          <WaitingLine ctx={ctx} />
          {panel}
          {/* The standings: above the log in the side column when the table
              gives one, else here under the decision. */}
          {ctx.sideSlot
            ? createPortal(<div className={`ngg-side${species ? ` seat-${species}` : ''}`}><SeatsPanel ctx={ctx} onOpen={setBoardFor} /><CultureRace ctx={ctx} /></div>, ctx.sideSlot)
            : <><SeatsPanel ctx={ctx} onOpen={setBoardFor} /><CultureRace ctx={ctx} /></>}
          {/* The numbered list: every legal move in the engine's words, the
              fallback for anything a screen does not draw. */}
          {ctx.menu && <div className="ngg-menu">{ctx.menu}</div>}
        </div>
      </div>
      {/* The seat's faction board, folded: in the page's bench when the table
          gives one, else along the bottom of the screen. */}
      {ctx.mine && (ctx.benchSlot
        ? createPortal(<FactionStrip ctx={ctx} player={ctx.mine} onOpen={() => setBoardFor(ctx.me)} />, ctx.benchSlot)
        : <FactionStrip ctx={ctx} player={ctx.mine} onOpen={() => setBoardFor(ctx.me)} />)}
      {boardPlayer && (
        <div className="sheet-backdrop" role="presentation" onClick={() => setBoardFor(null)}>
          <div className={`sheet ngg-board-sheet seat-${boardPlayer.species ?? 'wizard'}`} role="dialog"
            aria-label={boardPlayer.id === ctx.me ? 'Your faction board' : `${ctx.seat(boardPlayer.id)}'s faction board`} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn secondary small close" onClick={() => setBoardFor(null)} aria-label="Close the faction board">✕</button>
            <FactionBoard ctx={ctx} player={boardPlayer} />
          </div>
        </div>
      )}
      {interrupt && (
        <div className="ngg-interrupt-layer" role="presentation">
          <div className="ngg-interrupt" role="dialog" aria-label="Your decision, out of turn">{interrupt}</div>
        </div>
      )}
    </div>
  );
}
