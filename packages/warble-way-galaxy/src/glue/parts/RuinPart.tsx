// The ruin (RuinSetup.dc.html, Ruin.dc.html, Ruin-Terrains.dc.html; build
// item 5): a 9 × 9 scan in one of four terrains, chosen by the visit (a
// display choice, not a rule). Setup fills the engine's setup_encounter
// template from taps: who goes in, the threat level, the start spot and
// three attacker spots. A round draws the party, the attackers, and the
// acting being's listed moves: a tap on a floor square completes its
// move_being template, the rest are buttons. Where a being can step is the
// engine's list (the view's `reach`); with an engine that sends none, every
// floor square is offered and the engine answers. Stepping on the goal ends
// the level at once, so that square asks before it sends.

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { LegalMove } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import { ATTACKERS, faceUrl } from '../faces.js';
import { Hologram } from '../holo.js';
import { Icon, type IconName } from '../icons.js';
import { previewOf, words } from '../facts.js';
import { cellId, cellRC, moveById, type Ruin, type RuinAttack, type WwTable } from '../read.js';
import { GoldButton, Lbl, Num, Token } from '../ui.js';
import { Choice } from './Choice.js';
import { RollPanel } from './RollPanel.js';
import type { PartProps } from './SpacePart.js';

type TerrainKey = keyof typeof ATTACKERS;
interface Terrain { key: TerrainKey; name: string; label: string; accent: string; num: string; edge: string; section: CSSProperties; floor(i: number): CSSProperties; wall(i: number): CSSProperties }

const ROCK = ['14px 6px 18px 8px', '6px 16px 8px 14px', '18px 10px 6px 16px', '8px 18px 14px 6px'];
const BOULDER = ['42% 30% 46% 34%', '30% 44% 34% 46%', '46% 36% 30% 42%', '34% 46% 42% 30%'];
const BLOB = ['46% 38% 44% 40%', '38% 46% 40% 44%', '44% 40% 38% 46%', '40% 44% 46% 38%'];

function speckle(n: number, seed: number, colors: string[], sizes: number[], soft: boolean): string {
  const out: string[] = []; let s = seed;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < n; i++) {
    const x = Math.round(rnd() * 100), y = Math.round(rnd() * 100);
    const sz = sizes[Math.floor(rnd() * sizes.length)]!, col = colors[Math.floor(rnd() * colors.length)]!;
    out.push(`radial-gradient(${sz}px ${sz}px at ${x}% ${y}%, ${col}${soft ? ', transparent)' : ' 99%, transparent)'}`);
  }
  return out.join(', ');
}

const TERRAINS: Record<TerrainKey, Terrain> = {
  starry: {
    key: 'starry', name: 'Derelict in open space', label: 'DERELICT SCAN', accent: '#6eaaff', num: '#5d6aa8', edge: '#263064',
    section: { backgroundColor: '#060918', backgroundImage: `${speckle(70, 7, ['rgba(236,232,220,.35)', 'rgba(236,232,220,.6)', 'rgba(236,232,220,.9)'], [1, 1, 1.5, 2], false)}, radial-gradient(420px 300px at 75% 30%, rgba(120,90,200,.16), transparent 70%), radial-gradient(360px 260px at 20% 85%, rgba(60,140,200,.12), transparent 70%)` },
    floor: () => ({ borderRadius: 6, background: 'rgba(110,170,255,.05)', boxShadow: 'inset 0 0 0 1px rgba(110,170,255,.2)' }),
    wall: (i) => ({ borderRadius: ROCK[i % 4], backgroundColor: '#2b2944', backgroundImage: 'radial-gradient(10px 8px at 30% 35%, rgba(0,0,0,.35), transparent), radial-gradient(7px 6px at 68% 70%, rgba(0,0,0,.3), transparent)', boxShadow: 'inset 2px 3px 0 rgba(173,144,247,.22), inset -3px -4px 0 rgba(0,0,0,.45), 0 4px 10px rgba(0,0,0,.5)' }),
  },
  rocky: {
    key: 'rocky', name: 'Asteroid cavern', label: 'CAVERN SCAN', accent: '#f2b544', num: '#8a7a64', edge: '#3a3128',
    section: { backgroundColor: '#17130f', backgroundImage: `${speckle(160, 11, ['rgba(0,0,0,.45)', 'rgba(255,235,200,.08)', 'rgba(255,235,200,.14)'], [1.5, 2, 3], false)}, radial-gradient(380px 280px at 30% 25%, rgba(242,181,68,.08), transparent 70%)` },
    floor: () => ({ borderRadius: 4, backgroundColor: '#3a3128', backgroundImage: 'radial-gradient(9px 6px at 30% 40%, rgba(0,0,0,.22), transparent), radial-gradient(6px 4px at 72% 66%, rgba(255,235,200,.06), transparent)', boxShadow: 'inset 0 1px 0 rgba(255,235,200,.09), inset 0 -3px 0 rgba(0,0,0,.35)' }),
    wall: (i) => ({ borderRadius: BOULDER[i % 4], backgroundColor: '#6d6052', backgroundImage: 'radial-gradient(11px 8px at 32% 38%, rgba(0,0,0,.3), transparent), radial-gradient(7px 6px at 70% 68%, rgba(0,0,0,.28), transparent), radial-gradient(5px 4px at 62% 26%, rgba(255,235,200,.15), transparent)', boxShadow: 'inset 3px 4px 0 rgba(255,230,190,.18), inset -4px -5px 0 rgba(0,0,0,.45), 0 5px 10px rgba(0,0,0,.6)' }),
  },
  alien: {
    key: 'alien', name: 'Xeno hive', label: 'HIVE SCAN', accent: '#e070d0', num: '#7d5a8a', edge: '#3a1f45',
    section: { backgroundColor: '#0c0816', backgroundImage: `${speckle(46, 23, ['rgba(76,201,176,.55)', 'rgba(224,112,208,.5)', 'rgba(173,144,247,.45)'], [3, 4, 6], true)}, radial-gradient(400px 300px at 80% 20%, rgba(224,112,208,.14), transparent 70%), radial-gradient(380px 300px at 15% 80%, rgba(76,201,176,.12), transparent 70%)` },
    floor: (i) => ({ borderRadius: BLOB[i % 4], background: 'rgba(76,201,176,.07)', boxShadow: 'inset 0 0 0 1px rgba(76,201,176,.35), inset 0 0 14px rgba(76,201,176,.14)' }),
    wall: () => ({ borderRadius: '50%', backgroundColor: '#4a1f52', backgroundImage: 'radial-gradient(circle at 35% 30%, rgba(255,160,240,.38), transparent 45%), radial-gradient(circle at 65% 72%, rgba(0,0,0,.4), transparent 55%)', boxShadow: '0 0 14px rgba(224,112,208,.35), inset 0 0 0 2px rgba(224,112,208,.45)' }),
  },
  metal: {
    key: 'metal', name: 'Station hulk', label: 'HULK SCAN', accent: '#7fd8ff', num: '#5f6b85', edge: '#2a3242',
    section: { backgroundColor: '#0f131b', backgroundImage: 'repeating-linear-gradient(0deg, rgba(170,177,211,.05) 0 1px, transparent 1px 20px), repeating-linear-gradient(90deg, rgba(170,177,211,.05) 0 1px, transparent 1px 20px)' },
    floor: () => ({ borderRadius: 3, backgroundColor: '#252c3a', backgroundImage: 'radial-gradient(2px 2px at 8px 8px, #5c6780 99%, transparent), radial-gradient(2px 2px at calc(100% - 8px) 8px, #5c6780 99%, transparent), radial-gradient(2px 2px at 8px calc(100% - 8px), #5c6780 99%, transparent), radial-gradient(2px 2px at calc(100% - 8px) calc(100% - 8px), #5c6780 99%, transparent)', boxShadow: 'inset 0 0 0 1px #3a4458, inset 0 1px 0 rgba(255,255,255,.06)' }),
    wall: () => ({ borderRadius: 3, backgroundColor: '#4a5468', backgroundImage: 'repeating-linear-gradient(135deg, rgba(242,181,68,.28) 0 6px, rgba(16,20,42,.35) 6px 12px)', boxShadow: 'inset 0 2px 0 rgba(255,255,255,.22), inset 0 -3px 0 rgba(0,0,0,.45), inset 0 0 0 1px #6b7690, 0 3px 8px rgba(0,0,0,.5)' }),
  },
};

/** The terrain of this visit: a look picked from the map, the level and the captain's name, stable for the visit. */
export function terrainFor(ruin: Ruin, who: string): Terrain {
  const keys = Object.keys(TERRAINS) as TerrainKey[];
  let h = 0;
  for (const ch of `${ruin.map}|${ruin.level}|${ruin.targetDepth}|${ruin.purpose}|${who}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TERRAINS[keys[h % keys.length]!]!;
}

const MARK: Record<string, { icon: IconName; colour: string; scale: number; word: string }> = {
  G: { icon: 'swirl', colour: '#FFD700', scale: .54, word: 'Goal' }, A: { icon: 'skull', colour: '#d0656c', scale: .36, word: 'Attacker spot' },
  B: { icon: 'being', colour: '#4cc9b0', scale: .43, word: 'Being' }, I: { icon: 'chest', colour: '#f2b544', scale: .43, word: 'Cache' }, S: { icon: 'alien', colour: '', scale: .38, word: 'Start' },
};

interface MapProps {
  ruin: Ruin; terrain: Terrain; tile: number; captainRace: string; crewRaces: Record<string, string>;
  /** squares the person may tap, and what a tap does */
  tap?: (cell: string) => void; tappable?: (cell: string, glyph: string) => boolean;
  chosenStart?: string | null; chosenSpots?: string[]; picking?: boolean;
  targets?: string[]; acting?: string | null; note?: string;
  /** squares the acting being can end a move on, from the engine */
  reach?: string[];
  /** a badge on a square: which attacker has been placed there */
  labels?: Record<string, string>;
}

/** The 9 × 9 map, from the base grid (the reference data) with the live overlay. */
export function RuinMap({ ruin, terrain: T, tile, captainRace, crewRaces, tap, tappable, chosenStart, chosenSpots = [], picking, targets = [], acting, note, reach = [], labels = {} }: MapProps) {
  const rows = ruin.rows;
  const n = rows.length || 9;
  const gap = 5;
  const partyAt = new Map(ruin.party.map((t) => [t.cell, t]));
  const foeAt = new Map(ruin.attackers.filter((a) => !a.defeated).map((a) => [a.cell, a]));
  const roster = ATTACKERS[T.key];
  const actingCell = acting ? ruin.party.find((t) => t.name === acting)?.cell : undefined;
  const cells: JSX.Element[] = [];
  rows.forEach((row, ri) => {
    row.split('').forEach((glyph, ci) => {
      const r = ri + 1, c = ci + 1, id = cellId(r, c), i = r * 3 + c;
      const wall = glyph === '#';
      const pit = glyph === '~';
      const spent = ruin.spent.includes(id);
      const style: CSSProperties = { width: tile, height: tile, ...(wall ? T.wall(i) : T.floor(i)) };
      if (pit) Object.assign(style, { background: 'rgba(0,0,0,.55)', boxShadow: 'inset 0 0 18px rgba(0,0,0,.9), inset 0 0 0 1px rgba(110,170,255,.12)', borderRadius: 8 });
      const cls = ['ww-cell'];
      if (glyph === 'G' && !partyAt.has(id) && !foeAt.has(id)) cls.push('goal');
      if (picking && glyph === 'S') cls.push(chosenStart === id ? 'start-chosen' : 'start-other');
      if (!picking && ruin.startCell === id && !partyAt.has(id)) cls.push('start-chosen');
      if (glyph === 'A' && !foeAt.has(id) && !(chosenSpots.includes(id))) cls.push('spot-unused');
      if (chosenSpots.includes(id) && !foeAt.has(id)) cls.push('target');
      if (targets.includes(id)) cls.push('target');
      if (spent) cls.push('spent');
      if (reach.includes(id)) cls.push('reach');
      const can = !!tap && !!tappable && tappable(id, glyph);
      if (can) cls.push('tap');
      const token = partyAt.get(id);
      const foe = foeAt.get(id);
      // A cache opened or a figure met is gone; an attacker's starting square is only a mark while they are being placed.
      const mark = !wall && !pit && !token && !foe && !spent && !(glyph === 'A' && !picking) && MARK[glyph];
      const foeSize = Math.round(tile * .7);
      const label = `Row ${r}, column ${c}${wall ? ', wall' : pit ? ', pit' : ''}${token ? `, ${token.name}` : ''}${foe ? `, attacker ${foe.id}` : ''}${mark ? `, ${mark.word.toLowerCase()}` : ''}${spent ? ', spent' : ''}`;
      const inner = (
        <>
          {foe && (
            <span className="ww-cell-foe" style={{ width: foeSize, height: foeSize }}>
              {faceUrl(roster[foe.index % 3]!) ? <Hologram src={faceUrl(roster[foe.index % 3]!)!} kind="red" size={foeSize} style={{ border: '3px solid #f07070', borderRadius: '50%', boxShadow: '0 0 0 4px rgba(240,112,112,.18), 0 0 16px rgba(240,112,112,.7)' }} /> : <Icon name="skull" size={foeSize} />}
              <span className="ww-cell-badge">{foe.id} +{foe.atk}</span>
            </span>
          )}
          {token && !foe && (
            token.unnamed
              ? <Token race="redshirt" size={foeSize} ring="#f07070" glow="0 0 10px rgba(240,112,112,.5)" label={token.name} />
              : <Token race={token.captain ? captainRace : (crewRaces[token.name] ?? '')} size={foeSize} ring={token.captain ? '#FFD700' : T.accent} glow={token.captain ? '0 0 16px rgba(255,215,0,.6)' : `0 0 12px ${T.accent}`} label={token.name} />
          )}
          {mark && <span className="ww-cell-mark" style={{ color: mark.colour || T.accent }}><Icon name={mark.icon} size={Math.round(tile * mark.scale)} /></span>}
          {labels[id] && !foe && <span className="ww-cell-badge place">{labels[id]}</span>}
        </>
      );
      cells.push(can
        ? <button key={id} type="button" className={cls.join(' ')} style={style} onClick={() => tap!(id)} aria-label={label} data-cell={id}>{inner}</button>
        : <div key={id} className={cls.join(' ')} style={style} aria-label={label} role="img" data-cell={id}>{inner}</div>);
    });
  });
  const size = n * tile + (n - 1) * gap;
  const centre = (cell: string) => { const p = cellRC(cell)!; return { x: (p.c - 1) * (tile + gap) + tile / 2, y: (p.r - 1) * (tile + gap) + tile / 2 }; };
  const nums = Array.from({ length: n }, (_, i) => i + 1);
  return (
    <section className="ww-map" aria-label={`Ruin map ${ruin.map}`} style={{ ...T.section, '--ww-map-accent': T.accent, '--ww-map-edge': T.edge, '--ww-map-num': T.num, '--ww-gap': `${gap}px` } as CSSProperties}>
      <span className="ww-map-corner tl" /><span className="ww-map-corner tr" /><span className="ww-map-corner bl" /><span className="ww-map-corner br" />
      <Lbl className="ww-map-label">{ruin.map} · {T.label}</Lbl>
      <Num className="ww-map-note">{note}</Num>
      <div className="ww-col" style={{ gap }}>
        <div className="ww-map-cols" style={{ gridTemplateColumns: `16px repeat(${n}, ${tile}px)` }}><span />{nums.map((x) => <span key={x}>{x}</span>)}</div>
        <div className="ww-map-body">
          <div className="ww-map-rows" style={{ gridTemplateRows: `repeat(${n}, ${tile}px)` }}>{nums.map((x) => <span key={x}>{x}</span>)}</div>
          <div className="ww-map-cells" style={{ gridTemplateColumns: `repeat(${n}, ${tile}px)`, gridAutoRows: tile }}>
            {cells}
            <svg className="ww-map-svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
              {actingCell && [70, 120, 175].map((r, i) => { const o = centre(actingCell); return <circle key={r} cx={o.x} cy={o.y} r={r * (tile / 74)} fill="none" stroke={`rgba(255,215,0,${[.22, .14, .08][i]})`} strokeWidth="1" strokeDasharray={`2 ${6 + 2 * i}`} />; })}
              {actingCell && targets.map((t) => { const a = centre(actingCell), b = centre(t); return <line key={t} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f07070" strokeWidth="2" strokeDasharray="5 5" />; })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The attackers this level and threat would place, from the reference data's map. */
function attackersFor(input: PartProps['input'], map: string, threat: number): Array<{ atk: number; move: number; range: number; xp: number }> {
  const rd = input.reference?.referenceData;
  const maps = isObj(rd) && isObj(rd['ruins']) && isObj(rd['ruins']['maps']) ? rd['ruins']['maps'] : {};
  const def = isObj(maps[map]) ? maps[map] : {};
  const byThreat = isObj(def['attackers']) ? def['attackers'] : {};
  return asArr(byThreat[String(threat)]).filter(isObj).map((a) => ({ atk: asNum(a['atk']), move: asNum(a['move']), range: asNum(a['range']), xp: asNum(a['xp'], asNum(a['atk'])) }));
}

function AttackerRows({ list, roster, labels }: { list: Array<{ atk: number; move: number; range: number; xp?: number; id?: string; defeated?: boolean }>; roster: readonly string[]; labels?: string[] }) {
  return (
    <>
      {list.map((a, i) => (
        <div key={i} className="ww-row" style={{ gap: 10, fontSize: 13, opacity: a.defeated ? .4 : 1 }}>
          <Hologram src={faceUrl(roster[i % 3]!)!} kind="red" size={36} style={{ border: '2px solid #f07070', borderRadius: '50%' }} />
          <span className="ww-col" style={{ flex: 1 }}><span style={{ fontWeight: 600 }}>{labels?.[i] ?? `A${i + 1}`}{a.defeated ? ' · down' : ''}</span><Num className="ww-dim" style={{ fontSize: 11 }}>attack +{a.atk} · moves {a.move} · reach {a.range}</Num></span>
          {a.xp !== undefined && <Num style={{ color: '#FFD700' }} >{a.xp} XP</Num>}
        </div>
      ))}
    </>
  );
}

const crewRacesOf = (table: WwTable): Record<string, string> => Object.fromEntries(table.crew.map((c) => [c.name, c.race]));

/** How a being fights, in a line: "attacks with SWA +3 · reach 1 · takes the higher pair". */
const attackLine = (a: RuinAttack) => `attacks with ${a.ability} +${a.bonus} · reach ${a.range} · takes the ${a.advantage ? 'higher' : 'lower'} pair`;

function Legend({ T, round }: { T: Terrain; round?: boolean }) {
  return (
    <div className="ww-legend">
      <Lbl className="ww-dim" style={{ gridColumn: '1 / -1' }}>LEGEND</Lbl>
      <span><span style={{ color: '#FFD700' }}><Icon name="swirl" size={20} /></span>Goal</span>
      <span><span style={{ color: '#f2b544' }}><Icon name="chest" size={20} /></span>Cache</span>
      <span><span style={{ color: '#4cc9b0' }}><Icon name="being" size={20} /></span>A figure</span>
      <span><span style={{ color: T.accent }}><Icon name="alien" size={20} /></span>Start, and the way out</span>
      {!round && <span><span style={{ color: '#d0656c' }}><Icon name="skull" size={20} /></span>Where an attacker can stand</span>}
      <span><span style={{ width: 18, height: 18, flex: 'none', ...T.wall(1), borderRadius: 5 }} />Wall</span>
      {round && <span><span className="ww-legend-reach" />A square in reach</span>}
    </div>
  );
}

/** The engine's words on how a ruin runs, the lines that bear on the moment. */
function RuinWords({ input, keys }: { input: PartProps['input']; keys: string[] }) {
  const rt = words(input.reference, 'ruin_text');
  const lines = keys.map((k) => rt[k]).filter((l): l is string => !!l);
  if (lines.length === 0) return null;
  return <div className="ww-col" style={{ gap: 6 }}>{lines.map((l) => <span key={l} className="ww-tiny">{l}</span>)}</div>;
}

export function RuinSetupPart(props: PartProps & { right: (node: JSX.Element) => JSX.Element }) {
  const { table, input, pressable, onForm, right, phone } = props;
  const ruin = table.ruin!;
  const T = terrainFor(ruin, table.me?.name ?? '');
  const template = input.legalMoves.find((m) => m.move['type'] === 'setup_encounter');
  const [party, setParty] = useState<Set<string>>(new Set());
  const [captain, setCaptain] = useState<boolean | null>(null);
  const [shirts, setShirts] = useState(0);
  const [threat, setThreat] = useState<number | null>(null);
  const [start, setStart] = useState<string | null>(null);
  // One square per attacker, in the attackers' own order: the player says who stands where.
  const [spots, setSpots] = useState<Array<string | null>>([null, null, null]);
  const [placing, setPlacing] = useState(0);
  useEffect(() => { setParty(new Set()); setCaptain(null); setShirts(0); setThreat(null); setStart(null); setSpots([null, null, null]); setPlacing(0); }, [ruin.map, ruin.level, input.seq]);
  const starts = useMemo(() => ruin.rows.flatMap((row, ri) => row.split('').map((g, ci) => (g === 'S' ? cellId(ri + 1, ci + 1) : null)).filter((x): x is string => !!x)), [ruin.rows]);
  const placed = spots.filter((s): s is string => !!s);
  const count = (captain ? 1 : 0) + party.size + shirts;
  const ready = template && count > 0 && threat !== null && start !== null && placed.length === 3;
  const submit = () => {
    if (!template || !ready) return;
    onForm(template, { ...template.move, crew_names: [...party], include_character: captain === true, unnamed_count: shirts, start_location: start, threat_level: threat, attacker_placements: spots }, ['crew_names', 'include_character', 'unnamed_count', 'start_location', 'threat_level', 'attacker_placements']);
  };
  const tapSpot = (id: string) => setSpots((s) => {
    const at = s.indexOf(id);
    const next = [...s];
    if (at >= 0) { next[at] = null; setPlacing(at); return next; }
    next[placing] = id;
    const open = next.findIndex((x) => x === null);
    setPlacing(open >= 0 ? open : placing);
    return next;
  });
  const attackers = threat !== null ? attackersFor(input, ruin.map, threat) : [];
  const facts = (name: string) => ruin.candidates.find((c) => c.name === name);
  const shirtFacts = ruin.candidates.find((c) => c.kind === 'red_shirt');
  const labels = Object.fromEntries(spots.map((s, i) => [s ?? '', `A${i + 1}${attackers[i] ? ` +${attackers[i]!.atk}` : ''}`]).filter(([k]) => k !== ''));
  const who = (b: { name: string; title: string; race: string; abilities: Array<{ code: string; natural: number; effective: number }> }, you: boolean, on: boolean, flip: () => void) => {
    const f = facts(b.name);
    return (
      <button key={b.name} type="button" className={`ww-check-row${on ? ' on' : ''}`} role="checkbox" aria-checked={on} disabled={!pressable} onClick={flip} aria-label={`${b.title}${you ? ' (you)' : ''}`}>
        <Token race={b.race} size={38} />
        <span className="ww-col" style={{ flex: 1, minWidth: 0 }}>
          <span className="ww-hand" style={{ fontSize: 16, color: '#a9c4ff' }}>{b.title}{you ? ' (you)' : ''}</span>
          <Num className="ww-dim" style={{ fontSize: 11 }}>{f ? `moves ${f.moveAllowance} · ${attackLine(f.attack)}` : (b.abilities.filter((a) => a.natural > 0).map((a) => `${a.code} ${a.effective}`).join(' · ') || 'no scores')}</Num>
        </span>
        <span className="ww-check-box">{on ? '✓' : ''}</span>
      </button>
    );
  };
  const left = (
    <div className="ww-left">
      <section className="ww-panel">
        <div className="ww-row between"><Lbl style={{ color: '#FFD700' }}>1 · WHO GOES IN</Lbl><Num className="ww-dim" style={{ fontSize: 12 }}>{count} going in</Num></div>
        {table.me && who(table.me, true, !!captain, () => setCaptain((v) => !v))}
        {table.crew.map((c) => who(c, false, party.has(c.name), () => setParty((s) => { const n = new Set(s); if (n.has(c.name)) n.delete(c.name); else n.add(c.name); return n; })))}
        {table.unnamed > 0 && (
          <div className={`ww-check-row${shirts > 0 ? ' on' : ''}`} role="group" aria-label="Red shirts going in">
            <Token race="redshirt" size={38} ring="#e8b64a" />
            <span className="ww-col" style={{ flex: 1, minWidth: 0 }}><span className="ww-h2" style={{ fontSize: 15, color: '#ff9da1' }}>Red shirts · {shirts} of {table.unnamed}</span><Num className="ww-dim" style={{ fontSize: 11 }}>{shirtFacts ? `each moves ${shirtFacts.moveAllowance} · ${attackLine(shirtFacts.attack)}` : 'bodies for the fight'}</Num></span>
            <span className="ww-step-btns"><button type="button" aria-label="One fewer red shirt" disabled={!pressable || shirts <= 0} onClick={() => setShirts((n) => Math.max(0, n - 1))}>−</button><button type="button" aria-label="One more red shirt" disabled={!pressable || shirts >= table.unnamed} onClick={() => setShirts((n) => Math.min(table.unnamed, n + 1))}>+</button></span>
          </div>
        )}
        <span className="ww-tiny">Nobody goes in until you say so. Anyone left aboard is out of it.</span>
        <RuinWords input={input} keys={['struck']} />
      </section>
      <section className="ww-panel">
        <Lbl style={{ color: '#FFD700' }}>2 · THREAT LEVEL</Lbl>
        <div className="ww-seg">{[1, 2, 3].map((t) => <button key={t} type="button" className={threat === t ? 'on' : ''} disabled={!pressable} onClick={() => setThreat(t)} aria-pressed={threat === t}>Threat {t}</button>)}</div>
        {threat !== null ? <AttackerRows list={attackers} roster={ATTACKERS[T.key]} /> : <span className="ww-dim" style={{ fontSize: 12 }}>Pick a threat level to see who is waiting.</span>}
        <RuinWords input={input} keys={['threat']} />
      </section>
    </div>
  );
  const rightCol = (
    <>
      <section className="ww-panel">
        <Lbl style={{ color: '#FFD700' }}>3 · START SQUARE</Lbl>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          {starts.map((s) => { const p = cellRC(s)!; return <button key={s} type="button" className={`ww-spot-pick${start === s ? ' sel' : ''}`} disabled={!pressable} onClick={() => setStart(s)} aria-pressed={start === s}><span className="ww-h2" style={{ fontSize: 15 }}>Row {p.r} · col {p.c}</span><span className="ww-dim" style={{ fontSize: 11 }}>{start === s ? 'chosen' : 'tap, or tap the square'}</span></button>; })}
        </div>
        <RuinWords input={input} keys={['start']} />
      </section>
      <section className="ww-panel">
        <div className="ww-row between"><Lbl style={{ color: '#FFD700' }}>4 · WHERE EACH ATTACKER STANDS</Lbl><Num style={{ fontSize: 12, color: placed.length === 3 ? '#6fd08a' : '#9aa3c7' }}>{placed.length} of 3</Num></div>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: '#c9cfee' }}>Pick an attacker here, then tap a marked square for it. Tap a square again to clear it.</span>
        <div className="ww-col" style={{ gap: 6 }}>
          {[0, 1, 2].map((i) => {
            const a = attackers[i]; const s = spots[i]; const p = s ? cellRC(s) : null;
            return (
              <button key={i} type="button" className={`ww-spot-pick row${placing === i ? ' sel' : ''}`} disabled={!pressable} aria-pressed={placing === i} onClick={() => setPlacing(i)}>
                <span><b style={{ color: '#ff9da1' }}>A{i + 1}</b>{a ? <Num className="ww-dim" style={{ fontSize: 11 }}> attack +{a.atk} · moves {a.move} · reach {a.range}</Num> : null}</span>
                <span className="ww-dim" style={{ fontSize: 12 }}>{p ? `row ${p.r}, col ${p.c}` : placing === i ? 'tap a marked square' : 'not placed'}</span>
              </button>
            );
          })}
        </div>
        {threat === null && <span className="ww-tiny">Choose a threat level to see how strong each one is before you place it.</span>}
      </section>
      <section className="ww-panel">
        <Legend T={T} />
        <RuinWords input={input} keys={['round', 'goal']} />
      </section>
      <section className="ww-col" style={{ gap: 8, marginTop: 'auto' }}>
        <span className="ww-dim" style={{ fontSize: 12, textAlign: 'center' }}>Depth {ruin.targetDepth}: {ruin.level < ruin.targetDepth ? `reach the goal on ${ruin.map}, then set up the next map the same way.` : `reach the goal on ${ruin.map}.`}</span>
        <GoldButton onClick={submit} disabled={!pressable || !ready}>ENTER {ruin.map}</GoldButton>
        {!ready && <span className="ww-dim" style={{ fontSize: 12, textAlign: 'center' }}>{!template ? 'The engine is not asking for setup.' : count === 0 ? 'Choose who goes in.' : threat === null ? 'Choose a threat level.' : start === null ? 'Choose a start square.' : 'Place all three attackers.'}</span>}
      </section>
    </>
  );
  const map = (
    <RuinMap
      ruin={ruin} terrain={T} tile={phone ? 30 : 64} captainRace={table.me?.race ?? ''} crewRaces={crewRacesOf(table)}
      picking chosenStart={start} chosenSpots={placed} labels={labels} note={`setup${threat !== null ? ` · threat ${threat}` : ''}`}
      tappable={(_, g) => pressable && (g === 'S' || g === 'A')} tap={(id) => { const g = ruin.rows[cellRC(id)!.r - 1]?.[cellRC(id)!.c - 1]; if (g === 'S') setStart(id); else if (g === 'A') tapSpot(id); }}
    />
  );
  return (
    <>
      <div className={`ww-ruin-grid${props.sideOut ? ' side-out' : ''}`} style={phone ? { gridTemplateColumns: '1fr' } : undefined}>
        {left}
        {map}
        {right(rightCol)}
      </div>
    </>
  );
}

// Who was acting, kept across the table's events: a being that has moved and
// still has its action stays the one in hand.
let actingHeld: string | null = null;

export function RuinRoundPart(props: PartProps & { right: (node: JSX.Element) => JSX.Element }) {
  const { table, input, onMove, onForm, right, phone } = props;
  const ruin = table.ruin!;
  const T = terrainFor(ruin, table.me?.name ?? '');
  const p = table.pending;
  const moves = input.legalMoves;
  const rt = words(input.reference, 'ruin_text');
  // A new round begins the instant the last being ends its turn and the
  // attackers have moved. Hold the buttons for a moment, so a second press
  // meant for the old round cannot land on the new one.
  const [held, setHeld] = useState(false);
  const roundSeen = useRef(ruin.round);
  useEffect(() => {
    if (roundSeen.current === ruin.round) return;
    roundSeen.current = ruin.round;
    setHeld(true);
    const t = setTimeout(() => setHeld(false), 900);
    return () => clearTimeout(t);
  }, [ruin.round]);
  const pressable = props.pressable && !held;
  const movers = useMemo(() => [...new Set(moves.filter((m) => typeof m.move['being'] === 'string').map((m) => asStr(m.move['being'])))], [moves]);
  const [acting, setActingState] = useState<string | null>(actingHeld);
  const setActing = (n: string | null) => { actingHeld = n; setActingState(n); };
  useEffect(() => { if (!acting || !movers.includes(acting)) setActing(movers[0] ?? null); }, [movers, acting]);
  const [goalAsk, setGoalAsk] = useState(false);
  useEffect(() => { setGoalAsk(false); }, [input.seq, acting]);
  const mine = acting ? moves.filter((m) => asStr(m.move['being']) === acting) : [];
  const token = ruin.party.find((t) => t.name === acting);
  const moveT = mine.find((m) => m.move['type'] === 'move_being');
  const attacks = mine.filter((m) => m.move['type'] === 'attack');
  const converts = mine.filter((m) => m.move['type'] === 'convert_attacker');
  const targets = attacks.map((m) => ruin.attackers.find((a) => a.id === asStr(m.move['target']))?.cell).filter((x): x is string => !!x);
  const collect = mine.find((m) => m.move['type'] === 'collect_item');
  const approach = mine.find((m) => m.move['type'] === 'recruit_at');
  const escape = mine.find((m) => m.move['type'] === 'escape_to_start');
  const end = mine.find((m) => m.move['type'] === 'end_being_turn');
  const cont = p?.kind === 'ruin_continue';
  const deeper = moveById(moves, 'go-deeper'); const leave = moveById(moves, 'leave-ruin');
  // Where the acting being can end a move: the engine's list when it sends one.
  const knowsReach = token?.moveAllowance !== undefined;
  const reach = moveT && token ? token.reach : [];
  const free = (id: string) => !ruin.party.some((t) => t.cell === id) && !ruin.attackers.some((a) => !a.defeated && a.cell === id);
  const glyphAt = (id: string) => { const rc = cellRC(id); return rc ? ruin.rows[rc.r - 1]?.[rc.c - 1] ?? '' : ''; };
  const unopened = ruin.rows.flatMap((row, ri) => row.split('').map((g, ci) => ({ g, id: cellId(ri + 1, ci + 1) }))).filter((c) => (c.g === 'I' || c.g === 'B') && !ruin.spent.includes(c.id));
  const caches = unopened.filter((c) => c.g === 'I').length; const figures = unopened.filter((c) => c.g === 'B').length;
  const lastLevel = ruin.level >= ruin.targetDepth;
  const stepTo = (id: string) => moveT && onForm(moveT, { ...moveT.move, to: id }, ['to']);
  const name = (n: string) => ruin.party.find((t) => t.name === n)?.title ?? n;
  const left = (
    <div className="ww-left">
      <section className="ww-panel">
        <div className="ww-row between"><Lbl className="ww-dim">PARTY · ROUND {ruin.round}</Lbl><span className="ww-dim" style={{ fontSize: 12 }}>{held ? 'the attackers have moved' : ruin.attackerTurn === null ? 'your beings act' : 'the attackers act'}</span></div>
        {ruin.party.map((t) => {
          const can = movers.includes(t.name);
          const race = t.captain ? table.me?.race ?? '' : crewRacesOf(table)[t.name] ?? '';
          return (
            <button key={t.name} type="button" className={`ww-party-row${acting === t.name ? ' acting' : ''}${t.ended || !can ? ' done' : ''}${t.unnamed ? ' red' : ''}`} disabled={!can} onClick={() => setActing(t.name)} aria-pressed={acting === t.name} aria-label={t.title}>
              {t.unnamed ? <Token race="redshirt" size={44} ring="#e8b64a" /> : <Token race={race} size={44} />}
              <span className="ww-col" style={{ flex: 1, minWidth: 0 }}>
                <span className={t.unnamed ? 'ww-h2' : 'ww-hand'} style={{ fontSize: t.unnamed ? 15 : 17, color: t.unnamed ? '#ff9da1' : '#a9c4ff', lineHeight: 1.1 }}>{t.title}{t.captain ? ' (you)' : ''}</span>
                <Num style={{ fontSize: 11 }}>{t.moveAllowance !== undefined ? `${t.movesLeft ?? 0} of ${t.moveAllowance} moves left` : `moved ${t.moved}`}{t.acted ? ' · has acted' : ' · can still act'}</Num>
                {t.attack && <Num className="ww-dim" style={{ fontSize: 10.5 }}>{attackLine(t.attack)}</Num>}
              </span>
              {acting === t.name && can && <Lbl style={{ fontSize: 10, color: '#FFD700' }}>ACTING</Lbl>}
              {t.ended && <Lbl style={{ fontSize: 10, color: '#aab1d3' }}>DONE</Lbl>}
            </button>
          );
        })}
      </section>
      <section className="ww-panel">
        <Lbl className="ww-dim">ATTACKERS · THREAT {ruin.threat}</Lbl>
        <AttackerRows list={ruin.attackers} roster={ATTACKERS[T.key]} labels={ruin.attackers.map((a) => a.id)} />
        <RuinWords input={input} keys={['struck']} />
      </section>
    </div>
  );
  const way = (m: typeof end, icon: 'gun' | 'being' | 'chest' | 'alien' | 'convince' | 'rocket', label: string, shut?: string) => {
    const pv = previewOf(m);
    return <Choice key={label} icon={icon} name={label} input={input} roll={pv?.roll} lines={[pv?.then]} shut={m ? undefined : (shut ?? '')} disabled={!pressable} onClick={() => m && onMove(m)} />;
  };
  const rightCol = (
    <>
      {cont ? (
        <section className="ww-panel gold">
          <Lbl style={{ color: '#FFD700' }}>THE GOAL IS REACHED</Lbl>
          <span style={{ fontSize: 14, lineHeight: 1.45 }}>{deeper?.description ?? ''}</span>
          <GoldButton onClick={() => deeper && onMove(deeper)} disabled={!pressable || !deeper}>GO DEEPER</GoldButton>
          <span style={{ fontSize: 14, lineHeight: 1.45 }}>{leave?.description ?? ''}</span>
          <GoldButton onClick={() => leave && onMove(leave)} disabled={!pressable || !leave}>LEAVE</GoldButton>
        </section>
      ) : p?.kind === 'roll' ? null : goalAsk && ruin.goalCell ? (
        <section className="ww-panel gold" aria-label="Step onto the goal">
          <Lbl style={{ color: '#FFD700' }}>STEP ONTO THE GOAL?</Lbl>
          <span style={{ fontSize: 14, lineHeight: 1.45 }}>{rt['goal'] ?? 'Stepping on the goal ends this level at once.'}</span>
          {(caches > 0 || figures > 0) && <span style={{ fontSize: 14, lineHeight: 1.45, color: '#ff9da1' }}>Still on this map: {[caches > 0 ? `${caches} ${caches === 1 ? 'cache' : 'caches'} unopened` : '', figures > 0 ? `${figures} ${figures === 1 ? 'figure' : 'figures'} not met` : ''].filter(Boolean).join(' and ')}.{lastLevel ? ' They are left behind.' : ''}</span>}
          <GoldButton onClick={() => stepTo(ruin.goalCell!)} disabled={!pressable}>STEP ONTO THE GOAL</GoldButton>
          <GoldButton quiet onClick={() => setGoalAsk(false)}>NOT YET</GoldButton>
        </section>
      ) : (
        <section className="ww-panel">
          <Lbl style={{ color: '#FFD700' }}>{acting ? `${name(acting).toUpperCase()} · CHOOSE` : 'NO ONE LEFT TO ACT'}</Lbl>
          {token && moveT && (
            <span style={{ fontSize: 14, lineHeight: 1.45, color: '#b9bdd4' }}>
              {knowsReach
                ? reach.length > 0 ? `Tap a lit square to move there: ${token.movesLeft ?? 0} of ${token.moveAllowance} moves left.` : `No square is in reach: ${(token.movesLeft ?? 0) === 0 ? 'no moves left this round' : 'others are in the way'}.`
                : 'Tap a square to move there; the engine checks the path.'}
              {targets.length ? ' The red line shows who can be attacked.' : ''}
            </span>
          )}
          <div className="ww-ways one">
            {attacks.map((m) => way(m, 'gun', `Attack ${asStr(m.move['target'])}`))}
            {converts.map((m) => { const pv = previewOf(m); return <Choice key={m.move_id} icon="convince" name={`Call on ${asStr(m.move['target'])} to surrender`} input={input} roll={pv?.roll} lines={[!pv?.roll ? m.description : null]} disabled={!pressable} onClick={() => onMove(m)} />; })}
            {way(approach, 'being', 'Approach the figure', rt['being'] ?? 'Stand next to a figure first.')}
            {way(collect, 'chest', 'Open the cache', rt['cache'] ?? 'Stand next to a cache first.')}
            {way(escape, 'alien', 'Step out through the start', rt['start'] ?? 'Stand on the start square first.')}
            {way(end, 'rocket', `End ${acting ? name(acting) : ''}'s turn`)}
          </div>
        </section>
      )}
      {p?.kind === 'roll' && <RollPanel {...props} pressable={pressable} />}
      <section className="ww-panel" style={{ marginTop: 'auto' }}>
        <Legend T={T} round />
        <RuinWords input={input} keys={['goal']} />
      </section>
    </>
  );
  const map = (
    <RuinMap
      ruin={ruin} terrain={T} tile={phone ? 30 : 64} captainRace={table.me?.race ?? ''} crewRaces={crewRacesOf(table)}
      acting={acting} targets={targets} reach={reach} note={`threat ${ruin.threat} · round ${ruin.round}`}
      tappable={(id, g) => pressable && !!moveT && g !== '#' && g !== '~' && free(id) && (!knowsReach || reach.includes(id))}
      tap={(id) => { if (id === ruin.goalCell || glyphAt(id) === 'G') setGoalAsk(true); else stepTo(id); }}
    />
  );
  return (
    <>
      <div className={`ww-ruin-grid${props.sideOut ? ' side-out' : ''}`} style={phone ? { gridTemplateColumns: '1fr' } : undefined}>
        {left}
        {map}
        {right(rightCol)}
      </div>
    </>
  );
}

export type { LegalMove };
