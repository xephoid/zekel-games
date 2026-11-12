// A seat's faction board: folded into a strip under the table, and opened
// whole in a sheet. A wizard's is a page somebody wrote on (Ink), a robot's a
// part somebody machined (Oil); the difference is only the theme around it.
// Everything comes from the viewing seat's own view: public counts, the
// printed catalogue, and, on the seat's own board only, the private keys
// (hand, spy) only this seat receives. Another seat's board shows its hand as
// card backs.

import type { ScreenCtx } from './ctx.js';
import { coresOf, econOf, type NggPlayer } from './read.js';
import { economicCollectorsFor, type RefBuilding, type RefResearch, type RefUnit } from './ref.js';
import { useState, type KeyboardEvent } from 'react';
import { inkOf } from './factions.js';
import { TechTree } from './TechTree.js';
import { BattleCardPrice, CardBack, CostChips, FactionChip, Icon, Panel, SpyMark } from './ui.js';

const ACTION_CARDS: Array<{ key: string; played: string; name: string; icon: string }> = [
  { key: 'build', played: 'build', name: 'Build', icon: 'Build' },
  { key: 'moveBattle', played: 'move_battle', name: 'Move / Battle', icon: 'Move / Battle' },
  { key: 'research', played: 'research', name: 'Research', icon: 'Research' },
];

function Pips({ have, max, cap }: { have: number; max: number; cap: number }) {
  return (
    <span className="ngg-pips" aria-label={`${have} of ${max}`}>
      {Array.from({ length: cap }, (_, i) => (
        <i key={i} className={i < have ? 'on' : i < max ? 'room' : 'none'} />
      ))}
    </span>
  );
}

function Numbers({ p, need }: { p: NggPlayer; need: number | null }) {
  const cores = coresOf(p);
  const econ = econOf(p);
  const of = need ? <small>/{need}</small> : null;
  return (
    <div className="ngg-numbers">
      <span className="ngg-number"><i>CULTURE</i><b>{p.culture}</b></span>
      <span className="ngg-number"><i>TECH</i><b>{p.tech.total}{p.tech.target !== null ? <small>/{p.tech.target}</small> : null}</b></span>
      {p.species === 'robot'
        ? (
          <>
            <span className="ngg-number" title="In platforms and in collectors"><i>CORES FITTED</i><b>{cores.used}</b></span>
            <span className="ngg-number"><i>CORES SPARE</i><b>{cores.free}</b></span>
            <span className="ngg-number" title="Collectors owned, against the Economic victory's count"><i>COLLECTORS</i><b>{econ ? econ.owned : '—'}{of}</b></span>
          </>
        )
        : (
          <>
            <span className="ngg-number"><i>MANA</i><b>{p.manaCurrent}<small>/{p.manaMax}</small></b></span>
            <span className="ngg-number" title="Surfs owned, against the Economic victory's count"><i>SURFS</i><b>{econ ? econ.owned : '—'}{of}</b></span>
            <span className="ngg-number"><i>SUBJECTS</i><b>{p.subjects}</b></span>
            {Object.keys(p.bank).length > 0 && (
              <span className="ngg-number" title="What Haste banked this round; it pays later purchases this round and empties at upkeep"><i>BANK</i><b><CostChips cost={p.bank} /></b></span>
            )}
          </>
        )}
    </div>
  );
}

/** How many of a unit type the seat owns: collectors by type, Subjects and
 *  Cores off the map, every other unit on the map. */
function ownedCount(p: NggPlayer, u: RefUnit): number | null {
  if (u.collector) return p.ownedCollectors ? p.ownedCollectors.filter((c) => c.type === u.name).length : null;
  if (u.id === 'subject') return p.subjects;
  if (u.id === 'core') { const c = coresOf(p); return c.used + c.free; }
  return p.units.filter((x) => x.type === u.name).length;
}

/** A unit type's limit for this seat: the engine's, which follows the map for
 *  collectors and Cores; the printed maximum from an engine that does not say. */
function limitOf(p: NggPlayer, u: RefUnit): number {
  return p.unitLimits?.[u.name] ?? u.maxPerPlayer;
}

function ownedNote(p: NggPlayer, u: RefUnit): string {
  if (u.collector) {
    if (!p.ownedCollectors) return `${p.collectors.filter((c) => c.id && collectorType(p, c.resource) === u.name).length} on the map · up to ${limitOf(p, u)}`;
    const mine = p.ownedCollectors.filter((c) => c.type === u.name);
    const placed = mine.filter((c) => c.placedAt).length;
    const unpowered = mine.filter((c) => c.core === 'CORELESS').length;
    return [`${placed} on the map`, unpowered ? `${unpowered} without a Core` : null, `up to ${limitOf(p, u)}`].filter(Boolean).join(' · ');
  }
  if (u.id === 'subject') return `on the faction board · up to ${limitOf(p, u)}`;
  if (u.id === 'core') { const c = coresOf(p); return `${c.used} fitted · ${c.free} spare · up to ${limitOf(p, u)}`; }
  return `on the map · up to ${limitOf(p, u)}`;
}

/** A placed collector's type: a wizard's is a Surf, a robot's names its resource. */
function collectorType(p: NggPlayer, resource: string | null): string {
  if (p.species === 'wizard') return 'Surf';
  return resource ? `${resource[0]!.toUpperCase()}${resource.slice(1)} collector` : '';
}

function ActionCards({ p }: { p: NggPlayer }) {
  // Another seat's planned cards are face down: only how many is known.
  if (p.actionCardsPlayed === null) {
    return (
      <div className="ngg-action-cards">
        {ACTION_CARDS.map((c) => {
          const held = p.actionCards[c.key] ?? 0;
          return (
            <span key={c.key} className="ngg-action-card">
              <Icon name={c.icon} size={18} stroke={1.8} />
              <b>{c.name}</b>
              <i>{held} held</i>
            </span>
          );
        })}
        <span className="ngg-action-card facedown"><CardBack /><b>{p.actionCardsPlayedCount} played</b><i>face down</i></span>
      </div>
    );
  }
  const playedList = p.actionCardsPlayed;
  return (
    <div className="ngg-action-cards">
      {ACTION_CARDS.map((c) => {
        const held = p.actionCards[c.key] ?? 0;
        const played = playedList.filter((x) => x.startsWith(`${c.played}:`)).length;
        return (
          <span key={c.key} className={`ngg-action-card${played >= held && held > 0 ? ' used' : ''}`}>
            <Icon name={c.icon} size={18} stroke={1.8} />
            <b>{c.name}</b>
            <i>{held > 1 ? `${held - played} of ${held} in hand` : played > 0 ? 'on the stack' : 'in hand'}</i>
          </span>
        );
      })}
    </div>
  );
}

/** Whether the seat has unlocked a thing, from the engine's own list: a
 *  lock with what it needs, or a quiet check. Nothing when the engine does
 *  not say. */
function LockTag({ why }: { why: string | null | undefined }) {
  if (why === undefined) return null;
  return why
    ? <span className="ngg-lock locked" title={why}>Locked · {why}</span>
    : <span className="ngg-lock open">✓ Unlocked</span>;
}

/** A board item that opens its details on a press (and Enter or Space). */
function pressable(onPress: () => void) {
  return {
    role: 'button' as const, tabIndex: 0, onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress(); } },
  };
}

type Detail =
  | { kind: 'unit'; unit: RefUnit }
  | { kind: 'building'; building: RefBuilding }
  | { kind: 'research'; research: RefResearch }
  | { kind: 'hero'; name: string };

/** Everything the engine's catalogue says about one board item, and where
 *  the seat stands with it. */
function ItemDetail({ ctx, player, detail, onClose }: { ctx: ScreenCtx; player: NggPlayer; detail: Detail; onClose: () => void }) {
  const lines: Array<[string, React.ReactNode]> = [];
  let title = '';
  let body: string | null = null;
  if (detail.kind === 'unit') {
    const u = detail.unit;
    title = u.name;
    body = u.notes || null;
    if (u.init !== null) lines.push(['Stats', `Init ${u.init} · DMG ${u.dmg ?? '—'} · DEF ${u.def ?? '—'}`]);
    lines.push(['Cost', <CostChips key="c" cost={u.cost} />]);
    if (u.needsCore) lines.push(['Core', 'Needs a Core to act']);
    if (u.requiresBuilding) lines.push(['Needs', u.requiresBuilding]);
    if (u.collector) lines.push(['Collects', u.collectorResource ?? 'any resource']);
    if (u.immobile) lines.push(['Moves', 'Never (immobile)']);
    lines.push(['Owned', `${ownedCount(player, u) ?? '—'} · ${ownedNote(player, u)}`]);
    const why = player.locked?.units[u.name];
    if (player.locked) lines.push(['Status', why ? `Locked · ${why}` : 'Unlocked']);
  } else if (detail.kind === 'building') {
    const b = detail.building;
    title = b.name;
    body = b.effect || null;
    lines.push(['Cost', <CostChips key="c" cost={b.cost} />]);
    if (b.isBase) lines.push(['Kind', 'A base']);
    if (b.repeatableMax !== null) lines.push(['Up to', String(b.repeatableMax)]);
    const n = b.isBase ? player.bases.length : player.buildingCounts[b.id] ?? (player.buildings.includes(b.name) ? 1 : 0);
    lines.push(['Built', String(n)]);
  } else if (detail.kind === 'research') {
    const r = detail.research;
    title = r.name;
    body = r.effect || null;
    lines.push(['Cost', r.either.length ? <BattleCardPrice key="c" cost={r.cost} either={r.either} /> : <CostChips key="c" cost={r.cost} />]);
    lines.push(['Needs', r.prerequisite]);
    const done = player.research.includes(r.name) || player.research.includes(r.id);
    const why = player.locked?.research[r.name];
    lines.push(['Status', done ? 'Researched' : why ? `Locked · ${why}` : player.locked ? 'Unlocked' : 'Not researched']);
  } else {
    const h = player.heroes.find((x) => x.name === detail.name);
    const ref = ctx.ref?.heroes.find((x) => x.name === detail.name);
    title = detail.name;
    body = ref?.effect ?? null;
    if (h?.stats) lines.push(['Stats', h.stats]);
    if (ref) lines.push(['Kind', `${ref.category}${ref.species ? ` · ${ref.species} only` : ''}`]);
    if (h) lines.push(['Status', h.dead ? 'Killed' : h.coord === null ? 'Reserved: no base to place it' : `On ${ctx.tile(h.coord)}${h.leader ? ' · Leader (+2 DEF)' : ''}`]);
  }
  return (
    <div className="ngg-fb-detail-backdrop" role="presentation" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="ngg-fb-detail" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ngg-fb-detail-head">
          <span className="ngg-fb-list-mark"><Icon name={detail.kind === 'hero' ? 'Leader' : title} size={22} stroke={1.8} /></span>
          <h3>{title}</h3>
          <button type="button" className="ngg-fb-detail-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {body && <p>{body}</p>}
        <dl>
          {lines.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}
        </dl>
      </div>
    </div>
  );
}

/** A unit, building or technology id, by its printed name. */
function nameOfType(ctx: ScreenCtx, id: string): string {
  const ref = ctx.ref;
  return ref?.units.find((u) => u.id === id)?.name
    ?? ref?.buildings.find((b) => b.id === id)?.name
    ?? ref?.research.find((r) => r.id === id)?.name
    ?? id;
}

export function FactionStrip({ ctx, player, onOpen }: { ctx: ScreenCtx; player: NggPlayer; onOpen: () => void }) {
  const ink = inkOf(player.faction);
  return (
    <div className={`ngg-strip seat-${player.species ?? 'wizard'}`} data-flip-id={`ngg-supply:${player.id}`}>
      <div className="ngg-strip-id">
        <span className="ngg-strip-mark" style={{ background: ink.fill, color: ink.on }}>{ink.mark && <Icon name={ink.mark} size={22} stroke={1.8} />}</span>
        <span><b>{player.faction ?? 'Your seat'}</b><i>you · {player.species ?? 'no faction yet'}</i></span>
      </div>
      <Numbers p={player} need={economicCollectorsFor(ctx.ref, ctx.v.layout)} />
      <ActionCards p={player} />
      <div className="ngg-strip-hand" title={`${player.handCount} battle card${player.handCount === 1 ? '' : 's'} in hand`}>
        {ctx.v.hand.length > 0
          ? ctx.v.hand.map((c, i) => <span key={i} className="ngg-mini-card" title={c.effect}>{c.card}</span>)
          : <span className="muted">No battle cards</span>}
      </div>
      <button type="button" className="ngg-btn secondary" onClick={onOpen}>Open board</button>
    </div>
  );
}

export function FactionBoard({ ctx, player }: { ctx: ScreenCtx; player: NggPlayer }) {
  const { ref, v } = ctx;
  // The hand and the spy are private: only the seat's own board shows them.
  const own = player.id === ctx.me;
  const ink = inkOf(player.faction);
  const species = player.species ?? 'wizard';
  const buildings = (ref?.buildings ?? []).filter((b) => b.species === species);
  const research = (ref?.research ?? []).filter((r) => r.species === species);
  const units = (ref?.units ?? []).filter((u) => u.species === species);
  const treaties = v.treaties.filter((t) => t.partners.includes(player.id));
  const spy = own ? v.spies.find((s) => s.active) ?? null : null;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const locked = player.locked;
  return (
    <div className={`ngg-faction-board seat-${species}`}>
      <span className="ngg-ground" aria-hidden="true" />
      {treeOpen && <TechTree ctx={ctx} species={species} player={player} onClose={() => setTreeOpen(false)} />}
      <header className="ngg-fb-head">
        <span className="ngg-fb-mark" style={{ background: ink.fill, color: ink.on }}>{ink.mark && <Icon name={ink.mark} size={34} stroke={1.8} />}</span>
        <div>
          <div className="ngg-kicker">Faction board</div>
          <h2>{player.faction ?? (own ? 'Your seat' : ctx.seat(player.id))}</h2>
          <span className="ngg-tagchip">{species}</span>
          <button type="button" data-view-only className="ngg-link ngg-fb-tree-link" onClick={() => setTreeOpen(true)}>Tech tree</button>
        </div>
        <Numbers p={player} need={economicCollectorsFor(ctx.ref, ctx.v.layout)} />
      </header>

      {species === 'wizard'
        ? (
          <Panel title="Mana" kicker={`${player.manaCurrent} of ${player.manaMax}`}>
            <Pips have={player.manaCurrent} max={player.manaMax} cap={25} />
          </Panel>
        )
        : (
          <Panel title="Core bay">
            <div className="ngg-core-bay">
              <span title="In platforms and in collectors"><i>FITTED</i><b>{coresOf(player).used}</b></span>
              <span className="hl"><i>SPARE</i><b>{coresOf(player).free}</b></span>
              <span className="dashed"><i>UNPURCHASED</i><b>{player.coresSupply}</b></span>
            </div>
          </Panel>
        )}

      <Panel title="Technology" kicker={`${player.tech.total}${player.tech.target !== null ? ` of ${player.tech.target}` : ''} unique types`}>
        <Pips have={player.tech.total} max={player.tech.target ?? player.tech.total} cap={player.tech.target ?? player.tech.total} />
        {player.tech.acquiredTypes.length > 0 && (
          <p className="ngg-fb-note">{(player.tech.acquiredTypeNames ?? player.tech.acquiredTypes.map((id) => nameOfType(ctx, id))).join(' · ')}</p>
        )}
      </Panel>

      <div className="ngg-fb-grid">
        <Panel title="Buildings">
          <ul className="ngg-fb-list">
            {buildings.map((b) => {
              // A base is counted on the map, not among the buildings.
              const n = b.isBase ? player.bases.length : player.buildingCounts[b.id] ?? (player.buildings.includes(b.name) ? 1 : 0);
              return (
                <li key={b.id} className={`${n > 0 ? 'on' : 'off'} pressable`} {...pressable(() => setDetail({ kind: 'building', building: b }))}>
                  <span className="ngg-fb-list-mark"><Icon name={b.name} size={20} stroke={1.8} /></span>
                  <span><b>{b.name}</b>{n > 1 ? ` ×${n}` : ''}<i className="ngg-fb-effect">{b.effect}</i></span>
                  <span className="ngg-fb-state">{n > 0 ? 'BUILT' : <CostChips cost={b.cost} />}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
        <Panel title="Research">
          <ul className="ngg-fb-list">
            {research.map((r) => {
              const on = player.research.includes(r.name) || player.research.includes(r.id);
              return (
                <li key={r.id} className={`${on ? 'on' : 'off'}${!on && locked?.research[r.name] ? ' locked' : ''} pressable`} {...pressable(() => setDetail({ kind: 'research', research: r }))}>
                  <span className="ngg-fb-list-mark"><Icon name={r.name} size={20} stroke={1.8} /></span>
                  <span>
                    <b>{r.name}</b>
                    {/* A long "+ either" price sits under the name, so the text keeps its width. */}
                    {!on && r.either.length > 0 && <span className="ngg-fb-price"><BattleCardPrice cost={r.cost} either={r.either} /></span>}
                    <i className="ngg-fb-effect">{r.effect}</i>
                    {!on && <LockTag why={locked ? locked.research[r.name] ?? null : undefined} />}{!locked && <i>Needs {r.prerequisite}</i>}
                  </span>
                  <span className="ngg-fb-state">{on ? 'RESEARCHED' : r.either.length ? null : <CostChips cost={r.cost} />}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel title="Units">
        <div className="ngg-fb-units">
          {units.map((u) => {
            const owned = ownedCount(player, u);
            return (
              <div key={u.id} className={`ngg-fb-unit${owned ? ' owned' : ''}${locked?.units[u.name] ? ' locked' : ''} pressable`} {...pressable(() => setDetail({ kind: 'unit', unit: u }))}>
                <span className="ngg-fb-count" aria-label={owned === null ? 'count not published' : `${owned} owned`}>×{owned ?? '—'}</span>
                <span className="ngg-fb-list-mark"><Icon name={u.name} size={22} stroke={1.8} /></span>
                <b>{u.name}</b>
                {u.init !== null && (
                  <span className="ngg-statline">
                    <span><i>INIT</i>{u.init}</span><span><i>DMG</i>{u.dmg ?? '—'}</span><span><i>DEF</i>{u.def ?? '—'}</span>
                  </span>
                )}
                <CostChips cost={u.cost} />
                <i>{ownedNote(player, u)}</i>
                <LockTag why={locked ? locked.units[u.name] ?? null : undefined} />
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="ngg-fb-grid">
        <Panel title="Heroes">
          {(player.unrevealedSpies ?? 0) > 0 && (
            <div className="ngg-fb-spy"><SpyMark species={species} count={player.unrevealedSpies ?? 0} size={16} />
              <span>{own ? 'Your spy is marked SPY below.' : 'A spy rides one of these heroes; which one is secret.'}</span>
            </div>
          )}
          <ul className="ngg-fb-heroes">
            {player.heroes.length === 0 && <li className="muted">None yet</li>}
            {player.heroes.map((h) => (
              <li key={h.name} className={`${h.leader ? 'leader' : ''}${h.dead ? ' dead' : ''}${spy?.hero === h.name ? ' spy' : ''} pressable`} {...pressable(() => setDetail({ kind: 'hero', name: h.name }))}>
                <span className="ngg-avatar" style={{ background: ink.fill, color: ink.on }}>{h.name.split(/\s+/).map((w) => w[0]).slice(-2).join('')}</span>
                <span><b>{h.name}</b><i>{h.dead ? 'Killed' : h.stats ?? ''}{h.coord === null && !h.dead ? ' · reserved' : ''}</i></span>
                <span className="ngg-fb-state">{h.leader ? 'LEADER' : spy?.hero === h.name ? 'SPY' : ''}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Battle cards" kicker={`${player.handCount} held · ${v.deckCount} in the deck`}>
          {ref?.battleCardPurchase && (
            <div className="ngg-fb-card-cost">
              <span>Buy one on a Research action</span>
              <BattleCardPrice cost={ref.battleCardPurchase.cost} either={ref.battleCardPurchase.either} />
              {locked
                ? <LockTag why={locked.battleCards} />
                : ref.battleCardPurchase.unlockedBy[species] && <i>Needs the {ref.battleCardPurchase.unlockedBy[species]}</i>}
            </div>
          )}
          <div className="ngg-fb-hand">
            {own && v.hand.length > 0
              ? v.hand.map((c, i) => (
                  <div key={i} className="ngg-fb-card"><b>{c.card}</b><i>{c.effect}</i></div>
                ))
              : Array.from({ length: player.handCount }, (_, i) => <CardBack key={i} />)}
            {player.handCount === 0 && <span className="muted">None held</span>}
          </div>
        </Panel>
        <Panel title="Treaties">
          {locked && <div className="ngg-fb-treaty-lock"><LockTag why={locked.treaties} /></div>}
          <ul className="ngg-fb-list">
            {(ref?.treaties ?? []).map((t) => {
              const held = treaties.find((x) => x.name === t.name);
              const partner = held ? held.partners.find((x) => x !== player.id) ?? null : null;
              return (
                <li key={t.id} className={held ? 'on' : 'off'}>
                  <span className="ngg-fb-list-mark"><Icon name={t.name} size={20} stroke={1.8} /></span>
                  <span><b>{t.name}</b><i>{held ? `with ${ctx.seat(partner)}` : 'free'} · +{t.cultureIncome} culture</i></span>
                  {held && <FactionChip faction={v.players.find((p) => p.id === partner)?.faction ?? null} size={20} />}
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>

      <Panel title="Action cards"><ActionCards p={player} /></Panel>
      {detail && <ItemDetail ctx={ctx} player={player} detail={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
