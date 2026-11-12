// The Sweetlands board as the printed 14 × 11 grid of candies (build item 2):
// every square painted as a land with its own sprinkles and outline, glossy
// candy spaces, treat plates, the leaders' homes, the castle and a wafer
// frame, with a label on each side naming the land and the way pieces travel.
// Drawn at its design size (48 px squares) and scaled to fit its box.

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { CastleArt, Home, RoadArrow, Signpost, SugarCube, TravelArrow, TreatChip } from './art.js';
import { CASTLE_AREA, COLS, LAND, REGIONS, ROAD_ARROW, ROWS, SIDE, SQUARE, TILES, landEdges, type Region, type Tile } from './geometry.js';
import { FACTION_LOOK, LAND_EDGE, REGION_HOME, REGION_TREAT, TREAT_ART, treatName, type SlTable } from './read.js';

const LABEL = 28; // the side labels' thickness
const GAP = 14;
const FULL_W = LABEL * 2 + GAP * 2 + COLS * SQUARE;
const FULL_H = LABEL * 2 + GAP * 2 + ROWS * SQUARE;

const ACTION: Record<string, string> = { red: 'Battle', orange: 'Influence', yellow: 'Taxes', green: 'Free play', blue: 'Intel', purple: 'Castle' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface BoardProps {
  table: SlTable;
  /** what stands on each tile (or on 'castle') */
  pieces: Record<string, ReactNode[]>;
  /** extra drawing on a tile: the numbered outlines of item 6 */
  marks?: Record<string, ReactNode>;
  /** tiles a tap means something on */
  lit?: string[];
  onTile?: (tileId: string) => void;
}

/** A land inside a sentence: "your land", "Fudge’s land". */
export function landWords(table: SlTable, r: Region): string {
  return table.me?.homeRegion === r ? 'your land' : `${FACTION_LOOK[REGION_HOME[r]].short}’s land`;
}

/** A land on its own, as a label: "Your land (Milkshake)", "Fudge’s land". */
export function landName(table: SlTable, r: Region): string {
  const home = FACTION_LOOK[REGION_HOME[r]].short;
  return table.me?.homeRegion === r ? `Your land (${home})` : `${home}’s land`;
}

function tileTip(table: SlTable, t: Tile): string {
  const land = landName(table, t.region);
  const s = t.space;
  if (!s) return `${FACTION_LOOK[REGION_HOME[t.region]].short}’s home: pieces start here and return here when captured`;
  if (s.zone === 'treat') {
    const treat = s.index === 0 ? REGION_TREAT[t.region] : table.randomTreat[t.region];
    return s.index === 0 ? `${treatName(treat)} treat space · ${land}` : `${treatName(treat)} treat space (placed at random this game) · ${land}`;
  }
  const color = s.color ?? '';
  if (s.zone === 'road') return `${cap(color)} road space · ${land} · leads to the castle`;
  return `${cap(color)} space · ${land}${s.index === 5 ? ' · junction: you may turn onto the road here' : ''} · ${ACTION[color] ?? ''}`;
}

function TileView({ table, t, children, mark, lit, onTile }: { table: SlTable; t: Tile; children?: ReactNode; mark?: ReactNode; lit: boolean; onTile?: (id: string) => void }) {
  const s = t.space;
  const style = { gridRow: t.row, gridColumn: t.col + 1 } as const;
  let kind = 'sl-start';
  let inner: ReactNode = null;
  if (s && (s.zone === 'ring' || s.zone === 'road')) {
    kind = `sl-space sl-c-${s.color}`;
    inner = (
      <>
        {s.zone === 'road' && <RoadArrow deg={ROAD_ARROW[s.id] ?? 0} />}
        {s.zone === 'ring' && s.index === 5 && (
          <span className="sl-signpost" title="Crossroads: you may turn onto the road toward the castle here"><Signpost /></span>
        )}
      </>
    );
  } else if (s && s.zone === 'treat') {
    const treat = s.index === 0 ? REGION_TREAT[t.region] : table.randomTreat[t.region];
    kind = `sl-plate${s.index === 1 ? ' random' : ''}`;
    inner = treat && TREAT_ART[treat] ? <img className="sl-plate-art" src={TREAT_ART[treat]} alt={treatName(treat)} draggable={false} /> : null;
  } else {
    const home = REGION_HOME[t.region];
    kind = `sl-start sl-home-${home}`;
    inner = <Home faction={home} label={`${FACTION_LOOK[home].short}’s home`} />;
  }
  const cls = `sl-tile ${kind}${lit ? ' zk-lit' : ''}`;
  const content = (
    <>
      {inner}
      {children && <span className="sl-tile-pieces">{children}</span>}
      {mark}
    </>
  );
  if (lit && onTile) {
    return <button type="button" className={cls} style={style} title={tileTip(table, t)} data-tile={t.id} onClick={() => onTile(t.id)}>{content}</button>;
  }
  return <div className={cls} style={style} title={tileTip(table, t)} data-tile={t.id}>{content}</div>;
}

function Lands() {
  const squares: ReactNode[] = [];
  for (let row = 1; row <= ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const land = LAND[`${row},${col}`];
      if (!land) continue;
      const e = landEdges(row, col);
      const line = `5px solid ${LAND_EDGE[land]}`;
      squares.push(
        <div key={`${row},${col}`} className={`sl-land sl-land-${land}`} style={{ gridRow: row, gridColumn: col + 1 }} aria-hidden="true">
          <span style={{ borderTop: e.top ? line : undefined, borderRight: e.right ? line : undefined, borderBottom: e.bottom ? line : undefined, borderLeft: e.left ? line : undefined }} />
        </div>,
      );
    }
  }
  return <>{squares}</>;
}

function Castle({ table, children, mark }: { table: SlTable; children?: ReactNode; mark?: ReactNode }) {
  const foe = table.foe && !table.foe.defeated ? table.foe : null;
  return (
    <div
      className="sl-castle" data-tile="castle" title="The Candy Castle"
      style={{ gridRow: `${CASTLE_AREA.row} / span ${CASTLE_AREA.rowSpan}`, gridColumn: `${CASTLE_AREA.col} / span ${CASTLE_AREA.colSpan}` }}
    >
      <CastleArt />
      {foe && foe.dice !== null && (
        <span className="sl-foe" title={`The castle foe rolls ${foe.dice} sugar cubes when a Knight attacks it`} aria-label={`Castle foe: rolls ${foe.dice} sugar cubes`}>
          {Array.from({ length: foe.dice }, (_, i) => <SugarCube key={i} />)}
        </span>
      )}
      {children && <span className="sl-tile-pieces sl-castle-pieces">{children}</span>}
      {mark}
    </div>
  );
}

function SideLabel({ table, r }: { table: SlTable; r: Region }) {
  const { side, arrow } = SIDE[r];
  const home = REGION_HOME[r];
  const mine = table.me?.homeRegion === r;
  // The right label is turned half round as a whole so its words read
  // bottom to top; its pictures are turned back so they stay upright.
  const turn = side === 'right' ? 180 : 0;
  return (
    <div className={`sl-side sl-side-${side}${mine ? ' mine' : ''}`}>
      <span style={{ display: 'flex', transform: turn ? `rotate(${turn}deg)` : undefined }}><TreatChip faction={home} /></span>
      <b>{landName(table, r)}</b>
      <span className="sl-side-note">Region {r} · tax {table.taxes[r]}</span>
      <span className="sl-side-fill" />
      <span className="sl-side-note">pieces travel</span>
      <TravelArrow deg={arrow - turn} />
    </div>
  );
}

/** Scale the design-size board to the box it is given, never past 1.25. */
function useFit(ref: React.RefObject<HTMLDivElement | null>) {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      setScale(Math.max(0.4, Math.min(1.25, w / FULL_W, h / FULL_H)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

export function Board({ table, pieces, marks = {}, lit = [], onTile }: BoardProps) {
  const box = useRef<HTMLDivElement>(null);
  const scale = useFit(box);
  return (
    <div className="sl-board-box" ref={box}>
      <div className="sl-board-fit" style={{ width: FULL_W * scale, height: FULL_H * scale }}>
        <div className="sl-board-frame" style={{ width: FULL_W, height: FULL_H, transform: `scale(${scale})` }} data-flip-frame="sl-board">
          <span />
          <SideLabel table={table} r={3} />
          <span />
          <SideLabel table={table} r={4} />
          <div className="sl-board" role="group" aria-label="The Sweetlands board">
            <Lands />
            {TILES.map((t) => (
              <TileView key={t.id} table={table} t={t} mark={marks[t.id]} lit={lit.includes(t.id)} onTile={onTile}>
                {pieces[t.id]?.length ? pieces[t.id] : null}
              </TileView>
            ))}
            <Castle table={table} mark={marks['castle']}>{pieces['castle']?.length ? pieces['castle'] : null}</Castle>
          </div>
          <SideLabel table={table} r={2} />
          <span />
          <SideLabel table={table} r={1} />
          <span />
        </div>
      </div>
    </div>
  );
}
