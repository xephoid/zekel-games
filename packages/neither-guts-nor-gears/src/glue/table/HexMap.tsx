// The map. One map for every seat: the same inks, shapes, labels and
// positions. A seat owns only the frame around it, its selection and reach
// marks, and what the current decision lights.
//
// Engine coords are "c,r" in doubled rows (neighbours at (c, r±2) and
// (c±1, r±1)); flat-topped hexes, laid out as the canvas's Table board does.
// Every token carries a stable data-flip-id, so a unit that moves slides from
// its old hex to its new one and a new piece flies in from its owner's
// supply: nothing appears in place.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import type { NggPiece, NggTile, NggView, Species } from './read.js';
import type { NggRef } from './ref.js';
import { TERRAIN, inkOfSeat } from './factions.js';
import { Icon, Token } from './ui.js';

const HEXW = 104;
const HEXH = 90;
const COLW = 78;
const ROWH = 45;
const GUTTER = 26;
/** How many pieces a hex shows one by one before an army becomes a count. */
const BUDGET = 6;

export interface MapProposal {
  coord: string;
  owner: string;
  kind: 'collector' | 'unit' | 'hero' | 'base';
  /** the icon name (unit/collector) or the hero's name */
  name: string;
  key: string;
  /** the piece's own id (a collector's), so the dashed mark and the piece it
   *  becomes are one thing to the motion root: committing turns it solid in
   *  place instead of flying a second copy in from the supply */
  pieceId?: string;
}

export interface MapMarks {
  /** tiles this decision can take: cream rim, brighter tile, pressable */
  lit?: ReadonlySet<string>;
  /** tiles you might expect to take but cannot, each with the engine's reason */
  shut?: ReadonlyMap<string, string>;
  /** grey every tile that is not lit, shut or marked (not part of this choice) */
  greyRest?: boolean;
  /** where the decision starts from (an army's origin): ink rim */
  origin?: string | null;
  /** a battle: danger rim */
  contested?: string | null;
  /** the seat's own mark on a chosen tile */
  selected?: string | null;
  /** pieces not on the board yet, drawn dashed where they would go */
  proposals?: MapProposal[];
  /** a short tag on a tile: FROM, BATTLE, BASE */
  tags?: ReadonlyMap<string, string>;
  /** called with a lit tile's coord */
  onTile?: (coord: string) => void;
}

function piecesOf(v: NggView, t: NggTile) {
  const heroes = t.pieces.filter((p) => p.kind === 'hero');
  const units = t.pieces.filter((p) => p.kind === 'unit');
  // Usually one; two when Collector Optimizations lets them share (#102).
  const collectors = t.pieces.filter((p) => p.kind === 'collector');
  const speciesOf = (pid: string): Species | null => v.players.find((p) => p.id === pid)?.species ?? null;
  return { heroes, units, collectors, speciesOf };
}

function collectorIcon(species: Species | null, resource: string | null): string {
  if (species === 'wizard') return 'Surf';
  const r = resource ? TERRAIN[resource]?.name : null;
  return r ? `${r} collector` : 'Collector';
}

interface Inspect { coord: string; pieces: InspectPiece[] }
type InspectPiece = NggPiece | { kind: 'base'; owner: string };

/** A piece's name as a hover line: what it is and whose it is. */
/** A unit's DEF: the engine's number now, with the printed one beside it when they differ. */
function defText(live: number | null, printed: number | null): string {
  if (live === null || printed === null || live === printed) return String(live ?? printed ?? '—');
  return `${live} (printed ${printed})`;
}

function pieceTitle(v: NggView, refs: NggRef | null, p: InspectPiece): string {
  const faction = v.players.find((x) => x.id === p.owner)?.faction ?? p.owner;
  if (p.kind === 'base') return `${faction} base`;
  if (p.kind === 'hero') return `${p.name}${p.leader ? ' (Leader)' : ''} · ${faction}${p.stats ? ` · ${p.stats}` : ''}`;
  if (p.kind === 'collector') {
    const species = v.players.find((x) => x.id === p.owner)?.species ?? null;
    const label = species === 'wizard' ? 'Surf' : p.resource ? `${TERRAIN[p.resource]?.name ?? p.resource} collector` : 'Collector';
    return `${label} · ${faction}${p.resource ? ` · collecting ${p.resource}` : ''}`;
  }
  const u = refs?.units.find((x) => x.name === p.name);
  const stats = u && u.init !== null ? ` · Init ${u.init} DMG ${u.dmg ?? '—'} DEF ${defText(p.def, u.def)}` : '';
  return `${p.name} · ${faction}${stats}${p.core === 'CORELESS' ? ' · no Core' : ''}`;
}

/** A piece, pressable for its details where the hex is not part of the decision. */
function PieceBtn({ onInspect, pieces, children }: { onInspect: ((p: InspectPiece[]) => void) | null; pieces: InspectPiece[]; children: ReactNode }) {
  if (!onInspect) return <>{children}</>;
  return (
    <button type="button" className="ngg-piece-btn" data-view-only onClick={(e) => { e.stopPropagation(); onInspect(pieces); }}>
      {children}
    </button>
  );
}

/** A piece's details: its printed card, from the catalogue, and its state. */
function PieceDetails({ v, refs, inspect, onClose }: { v: NggView; refs: NggRef | null; inspect: Inspect; onClose: () => void }) {
  const tile = v.tiles.find((t) => t.coord === inspect.coord);
  return (
    <div className="ngg-float ngg-piece-details" role="dialog" aria-label={`Pieces at ${tile?.label ?? inspect.coord}`}>
      <div className="ngg-piece-details-head">
        <span className="ngg-float-title">{tile?.label ?? inspect.coord}</span>
        <button type="button" className="ngg-piece-details-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <ul>
        {inspect.pieces.map((p, i) => {
          const faction = v.players.find((x) => x.id === p.owner)?.faction ?? null;
          const unit = p.kind === 'unit' ? refs?.units.find((x) => x.name === p.name) ?? null : null;
          const liveDef = p.kind === 'unit' ? p.def : null;
          const hero = p.kind === 'hero' ? refs?.heroes.find((x) => x.name === p.name) ?? null : null;
          const name = pieceTitle(v, refs, p).split(' · ')[0];
          return (
            <li key={i}>
              <span className="ngg-piece-details-name"><b>{name}</b><i>{faction ?? p.owner}</i></span>
              {unit && unit.init !== null && (
                <span className="ngg-statline">
                  <span><i>INIT</i>{unit.init}</span><span><i>DMG</i>{unit.dmg ?? '—'}</span><span><i>DEF</i>{liveDef ?? unit.def ?? '—'}</span>
                </span>
              )}
              {unit && liveDef !== null && unit.def !== null && liveDef !== unit.def && (
                <span className="ngg-piece-details-note">DEF {liveDef}: printed {unit.def}, {liveDef > unit.def ? 'raised' : 'lowered'} by research.</span>
              )}
              {p.kind === 'hero' && p.stats && <span className="ngg-piece-details-stats">{p.stats}</span>}
              {p.kind === 'unit' && p.core === 'CORELESS' && <span className="ngg-piece-details-note">No Core: it cannot act until one is fitted.</span>}
              {p.kind === 'collector' && p.resource && <span className="ngg-piece-details-note">Collecting {p.resource} this round.</span>}
              {unit?.notes && <span className="ngg-piece-details-note">{unit.notes}</span>}
              {hero?.effect && <span className="ngg-piece-details-note">{hero.effect}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TilePieces({ v, t, proposals, refs, onInspect }: {
  v: NggView; t: NggTile; proposals: MapProposal[]; refs: NggRef | null;
  /** open a piece's details; null where the hex is part of the decision */
  onInspect: ((p: InspectPiece[]) => void) | null;
}) {
  const { heroes, units, collectors, speciesOf } = piecesOf(v, t);
  const factionOf = (pid: string) => v.players.find((p) => p.id === pid)?.faction ?? null;
  const title = (p: InspectPiece) => pieceTitle(v, refs, p);
  const crowded = heroes.length + units.length > BUDGET;
  const armies = new Map<string, NggPiece[]>();
  for (const u of units) armies.set(u.owner, [...(armies.get(u.owner) ?? []), u]);
  const baseFaction = t.baseOwner ? factionOf(t.baseOwner) : null;
  const dashedCollectors = proposals.filter((p) => p.kind === 'collector');
  return (
    <div className="ngg-tile-pieces">
      <div className="ngg-tile-army">
        {t.baseOwner && (
          <span data-flip-id={`ngg-base:${t.coord}`} data-flip-from={`ngg-supply:${t.baseOwner}`}>
            <PieceBtn onInspect={onInspect} pieces={[{ kind: 'base', owner: t.baseOwner }]}>
              <Token kind="base" faction={baseFaction} name="Base" size={20} title={title({ kind: 'base', owner: t.baseOwner })} />
            </PieceBtn>
          </span>
        )}
        {heroes.map((h) => (
          <span key={h.name} data-flip-id={`ngg-hero:${h.name}`} data-flip-from={`ngg-supply:${h.owner}`}>
            <PieceBtn onInspect={onInspect} pieces={[h]}>
              <Token kind="hero" faction={factionOf(h.owner)} name={h.name} leader={h.leader} size={22} title={title(h)} />
            </PieceBtn>
          </span>
        ))}
        {crowded
          ? [...armies.entries()].map(([owner, list]) => {
              const ink = inkOfSeat(v, owner);
              return (
                <PieceBtn key={owner} onInspect={onInspect} pieces={list}>
                  <span className="ngg-army-chip" style={{ background: ink.fill, color: ink.on }} title={`${factionOf(owner) ?? owner}: ${list.map((u) => u.name).join(', ')}`}>
                    {list.length}
                  </span>
                </PieceBtn>
              );
            })
          : units.map((u) => (
              <span key={u.id ?? u.name} data-flip-id={`ngg-unit:${u.id ?? u.name}`} data-flip-from={`ngg-supply:${u.owner}`}>
                <PieceBtn onInspect={onInspect} pieces={[u]}>
                  <Token kind="unit" faction={factionOf(u.owner)} name={u.name} size={22} title={title(u)} />
                </PieceBtn>
              </span>
            ))}
        {proposals.filter((p) => p.kind !== 'collector').map((p) => (
          <Token key={p.key} kind={p.kind} faction={factionOf(p.owner)} name={p.name} state="dashed" size={22} />
        ))}
      </div>
      {(collectors.length > 0 || dashedCollectors.length > 0) && (
        <span className="ngg-tile-collectors">
          {collectors.map((c) => (
            <span key={c.id ?? c.name} className="ngg-tile-collector" data-flip-id={`ngg-collector:${c.owner}:${c.id}`} data-flip-from={`ngg-supply:${c.owner}`}>
              <PieceBtn onInspect={onInspect} pieces={[c]}>
                <Token kind="collector" faction={factionOf(c.owner)} name={collectorIcon(speciesOf(c.owner), c.resource)} size={18} title={title(c)} />
              </PieceBtn>
            </span>
          ))}
          {dashedCollectors.map((d) => (
            <span key={d.key} className="ngg-tile-collector"
              data-flip-id={d.pieceId ? `ngg-collector:${d.owner}:${d.pieceId}` : undefined}
              data-flip-from={d.pieceId ? `ngg-supply:${d.owner}` : undefined}>
              <Token kind="collector" faction={factionOf(d.owner)} name={d.name} state="dashed" size={18} />
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** The scale that fits the whole map in its box, at every size. */
function useFit(w: number, h: number) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      setFit(Math.max(0.3, Math.min(r.width / w, r.height / h, 1.6)));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);
  return { box, fit };
}

/** Three fixed stops (the canvas's Map Zoom): the whole map, the board at
 *  its own size, and one hex close up. No free zoom. */
export type ZoomStop = 'whole' | 'board' | 'hex';
const ZOOM_STOPS: Array<{ stop: ZoomStop; label: string }> = [
  { stop: 'whole', label: 'Whole map' }, { stop: 'board', label: 'Board' }, { stop: 'hex', label: 'Hex' },
];

function ZoomControl({ zoom, setZoom }: { zoom: ZoomStop; setZoom: (z: ZoomStop) => void }) {
  return (
    <div className="ngg-zoom" role="group" aria-label="Map zoom">
      {ZOOM_STOPS.map((z) => (
        <button key={z.stop} type="button" data-view-only className={zoom === z.stop ? 'on' : ''} aria-pressed={zoom === z.stop} onClick={() => setZoom(z.stop)}>
          <i className={`ngg-zoom-hex ${z.stop}`} aria-hidden="true" />{z.label}
        </button>
      ))}
    </div>
  );
}

export function HexMap({ v, marks = {}, seatSpecies, overlay, refs = null }: {
  v: NggView;
  marks?: MapMarks;
  /** the printed catalogue, for a piece's details */
  refs?: NggRef | null;
  /** the viewing seat's species: its selection mark is inked or machined */
  seatSpecies?: Species | null;
  /** floating panels over the board (the action stack, pills) */
  overlay?: ReactNode;
}) {
  const cs = v.tiles.map((t) => t.c);
  const rs = v.tiles.map((t) => t.r);
  const cMin = cs.length ? Math.min(...cs) : 0;
  const cMax = cs.length ? Math.max(...cs) : 0;
  const rMin = rs.length ? Math.min(...rs) : 0;
  const rMax = rs.length ? Math.max(...rs) : 0;
  const mapW = (cMax - cMin) * COLW + HEXW + GUTTER;
  const mapH = (rMax - rMin) * ROWH + HEXH + GUTTER;
  const { box, fit } = useFit(mapW + 24, mapH + 24);
  const [zoom, setZoom] = useState<ZoomStop>('whole');
  // Each stop is a step closer than the one before: Board about twice the
  // whole map, Hex about four times, whatever the window.
  const scale = zoom === 'whole' ? fit : zoom === 'board' ? Math.max(fit * 1.8, 1) : Math.max(fit * 3.6, 2.4);
  // The piece whose details are open (a click on a piece where the hex is not
  // part of the decision).
  const [inspect, setInspect] = useState<Inspect | null>(null);
  useEffect(() => {
    if (!inspect) return;
    const close = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setInspect(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [inspect]);
  const panned = scale > fit + 0.001;
  const scroller = useRef<HTMLDivElement>(null);
  // A new stop keeps what was in the middle in the middle, or starts centred.
  const lastScale = useRef(scale);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ratio = scale / lastScale.current;
    lastScale.current = scale;
    const cx = (el.scrollLeft + el.clientWidth / 2) * ratio;
    const cy = (el.scrollTop + el.clientHeight / 2) * ratio;
    el.scrollLeft = Math.max(0, cx - el.clientWidth / 2);
    el.scrollTop = Math.max(0, cy - el.clientHeight / 2);
  }, [scale]);
  // Drag to pan when zoomed in; a click on a hex is still a click.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!panned || !el || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = scroller.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    d.moved = true;
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  const endDrag = () => { setTimeout(() => { drag.current = null; }, 0); };
  const onClickCapture = (e: React.MouseEvent) => { if (drag.current?.moved) { e.stopPropagation(); e.preventDefault(); } };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const order: ZoomStop[] = ['whole', 'board', 'hex'];
    const i = order.indexOf(zoom);
    if (e.key === '+' || e.key === '=') setZoom(order[Math.min(2, i + 1)]!);
    else if (e.key === '-') setZoom(order[Math.max(0, i - 1)]!);
    else if (e.key === '0') setZoom('whole');
    else return;
    e.preventDefault();
  };
  const x = (c: number) => GUTTER + (c - cMin) * COLW;
  const y = (r: number) => GUTTER + (r - rMin) * ROWH;

  const columns = [...new Set(cs)].sort((a, b) => a - b);
  const letterOf = (c: number) => v.tiles.find((t) => t.c === c)?.label.replace(/\d+$/, '') ?? '';

  return (
    <div className="ngg-map-box" ref={box}>
      <div
        className={`ngg-map-scroll${panned ? ' panned' : ''}`}
        ref={scroller}
        tabIndex={0}
        aria-label="The map. Plus and minus change the zoom; zero shows the whole map."
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onClickCapture={onClickCapture}
      >
      <div className="ngg-map-canvas" style={panned ? { width: mapW * scale + 48, height: mapH * scale + 48 } : undefined}>
      <div className="ngg-map" data-flip-frame="ngg-map" style={panned
        ? { width: mapW, height: mapH, left: 24, top: 24, transform: `scale(${scale})`, transformOrigin: 'top left' }
        : { width: mapW, height: mapH, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {columns.map((c) => (
          <span key={`col${c}`} className="ngg-map-col" style={{ left: x(c) + HEXW / 2 }}>{letterOf(c)}</span>
        ))}
        {v.tiles.map((t) => {
          const lit = marks.lit?.has(t.coord) ?? false;
          const shut = marks.shut?.get(t.coord) ?? null;
          const isOrigin = marks.origin === t.coord;
          const contested = marks.contested === t.coord;
          const grey = !!marks.greyRest && !lit && !shut && !isOrigin && !contested;
          const terrain = t.resource ? TERRAIN[t.resource] : null;
          const cls = `ngg-hex${lit ? ' lit' : ''}${shut ? ' shut' : ''}${grey ? ' grey' : ''}${isOrigin ? ' origin' : ''}${contested ? ' contested' : ''}`;
          const tag = marks.tags?.get(t.coord);
          const proposals = (marks.proposals ?? []).filter((p) => p.coord === t.coord);
          const style = { left: x(t.c), top: y(t.r) };
          const title = [t.label, terrain?.name, shut].filter(Boolean).join(' · ');
          const inner = (
            <>
              <span className="ngg-hex-rim" aria-hidden="true" />
              <span className="ngg-hex-face" style={{ background: terrain?.tile ?? '#8d8577' }}>
                <span className="ngg-hex-code">{t.label}</span>
                {terrain && <span className="ngg-hex-glyph"><Icon name={terrain.icon} size={13} stroke={2.2} /></span>}
                {t.start !== null && !t.baseOwner && <span className="ngg-hex-start">{t.start}</span>}
                {shut && <span className="ngg-hex-bar" aria-hidden="true" />}
              </span>
              <TilePieces v={v} t={t} proposals={proposals} refs={refs}
                onInspect={lit && marks.onTile ? null : (pieces) => setInspect({ coord: t.coord, pieces })} />
              {marks.selected === t.coord && <SeatMark species={seatSpecies ?? null} />}
              {tag && <span className="ngg-hex-tag">{tag}</span>}
            </>
          );
          return lit && marks.onTile
            ? <button key={t.coord} type="button" className={cls} style={style} title={title} aria-label={title} onClick={() => marks.onTile!(t.coord)}>{inner}</button>
            : <div key={t.coord} className={cls} style={style} title={title}>{inner}</div>;
        })}
      </div>
      </div>
      </div>
      {overlay}
      {inspect && <PieceDetails v={v} refs={refs} inspect={inspect} onClose={() => setInspect(null)} />}
      <ZoomControl zoom={zoom} setZoom={setZoom} />
    </div>
  );
}

/** The seat's own selection mark: a drawn ring for a wizard, corner brackets for a robot. */
function SeatMark({ species }: { species: Species | null }) {
  if (species === 'robot') {
    return <span className="ngg-seatmark robot" aria-hidden="true"><i /><i /><i /><i /></span>;
  }
  return (
    <svg className="ngg-seatmark wizard" viewBox="0 0 104 90" aria-hidden="true">
      <path d="M27 4 Q 51 1.4, 76 4.6 Q 101 43, 76 86 Q 51 88.6, 27 85.8 Q 2 44, 27 4 Z" />
    </svg>
  );
}
