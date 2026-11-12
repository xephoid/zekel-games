// The players panel (build item 4): one card per seat, yours ringed in
// orange. Points as a striped bar that says how many are still to go,
// influence, sugar cubes and cards in hand, then each piece and where it is.
// A row and the piece on the board share one focus: clicking either rings both.

import type { UnitKey } from './art.js';
import { Piece, pieceTitle, placeWords } from './Piece.js';
import { landWords } from './Board.js';
import { cap } from './colors.js';
import { TILE_BY_ID } from './geometry.js';
import { FACTION_LOOK, LAND_EDGE, REGION_TREAT, UNITS, UNIT_NAME, tileOf, treatName, type SlPlayer, type SlTable, type UnitLocation } from './read.js';

interface Props {
  table: SlTable;
  focus: string | null;
  onFocus(id: string): void;
  nameFor(pid: string): string;
}

/** The narrow column's place: the space's color as a swatch, then the land. */
function shortPlace(table: SlTable, loc: UnitLocation | null): { color: string | null; words: string } {
  const tile = tileOf(loc);
  const t = tile ? TILE_BY_ID[tile] : undefined;
  if (!loc || !tile) return { color: null, words: 'off the board' };
  if (tile === 'castle') return { color: null, words: 'in the castle' };
  if (!t) return { color: null, words: 'off the board' };
  if (loc.zone === 'start') return { color: null, words: 'at home' };
  if (loc.zone === 'treat') return { color: null, words: `${treatName(loc.slotKind === 'random' ? table.randomTreat[t.region] : REGION_TREAT[t.region])} treat` };
  const land = cap(landWords(table, t.region));
  return { color: t.space?.color ?? null, words: loc.zone === 'road' ? `road · ${land}` : land };
}

function PointsBar({ p, toWin }: { p: SlPlayer; toWin: number }) {
  const left = Math.max(0, toWin - p.points);
  const words = left === 0 ? 'Winner!' : `${left} to go`;
  const fill = p.homeRegion ? LAND_EDGE[p.homeRegion] : '#2c2c2c';
  const filled = Math.min(p.points, toWin);
  return (
    <div className="sl-points" role="img" aria-label={`${p.points} of ${toWin} points, ${words}`}>
      {Array.from({ length: toWin }, (_, i) => (
        <span key={i} className={`sl-pip${i < filled ? ' on' : ''}`} style={i < filled ? { backgroundColor: fill } : undefined} />
      ))}
      <span className="sl-points-words" style={{ left: left === 0 ? 0 : `${(filled / toWin) * 100}%` }}>{words}</span>
    </div>
  );
}

function PlayerCard({ table, p, focus, onFocus, nameFor }: Props & { p: SlPlayer }) {
  const look = p.faction ? FACTION_LOOK[p.faction] : null;
  const short = look?.short ?? p.name;
  const pill = p.isMe ? (p.active ? 'Your turn' : null) : p.ai ? 'AI' : 'Friend';
  const cap = table.influenceCap;
  return (
    <section className={`sl-player${p.isMe ? ' me' : ''}${p.active ? ' active' : ''}`} aria-label={p.isMe ? `You, ${p.name}` : `${short}, ${nameFor(p.pid)}`}>
      <div className="sl-player-head">
        {look ? <img src={look.portrait} alt="" className="sl-portrait" style={{ borderColor: look.border }} /> : <span className="sl-portrait" />}
        <div className="sl-player-names">
          <div className="sl-player-short">{p.isMe ? `You · ${short}` : short}</div>
          <div className="sl-player-full">{p.name}</div>
        </div>
        {pill && <span className={`sl-pill${p.isMe ? ' mine' : ''}`}>{pill}</span>}
      </div>
      <PointsBar p={p} toWin={table.pointsToWin ?? 5} />
      <div className="sl-player-stats">
        <span><b>{p.influence}</b>{cap ? `/${cap}` : ''} influence</span>
        <span><b>{p.sugar}</b> sugar</span>
        <span><b>{p.handCount}</b> {p.handCount === 1 ? 'card' : 'cards'}</span>
      </div>
      <ul className="sl-player-pieces">
        {UNITS.map((u: UnitKey) => {
          const id = `${p.pid}:${u}`;
          const where = shortPlace(table, p.units[u]);
          const on = focus === id;
          return (
            <li key={u}>
              <button type="button" className={`sl-piece-row${on ? ' on' : ''}`} aria-pressed={on} onClick={() => onFocus(id)} title={pieceTitle(table, p, u)}>
                <Piece player={p} unit={u} size={20} title="" />
                <span className="sl-piece-name">{UNIT_NAME[u]}</span>
                <span className="sl-piece-where" title={placeWords(table, p.units[u])}>
                  {where.color && <span className={`sl-swatch sl-c-${where.color}`} />}
                  <span>{where.words}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Players(props: Props) {
  const { table } = props;
  // Your own card first, then the others in seat order.
  const order = [...table.players.filter((p) => p.isMe), ...table.players.filter((p) => !p.isMe)];
  return (
    <div className="sl-players" aria-label="Players and their pieces">
      <div className="sl-col-head">
        <h2 className="sl-h">Players and their pieces</h2>
        <div className="sl-hint">Click a piece to find it on the board.</div>
      </div>
      {order.map((p) => <PlayerCard key={p.pid} {...props} p={p} />)}
    </div>
  );
}
