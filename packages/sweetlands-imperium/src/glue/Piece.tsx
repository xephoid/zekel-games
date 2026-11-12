// A piece on the candy table (build item 3): shaped like its faction's treat,
// with a picture inside that says which piece it is (crown = Leader, sword =
// Knight, wrapped candy = Ambassador). 25 px on the board, 20 px in the
// players panel. The Quiche (Nomads) has no shape yet, so its pieces stay a
// plain dark disc with the piece's initial.

import { PieceArt } from './art.js';
import { landWords } from './Board.js';
import { TILE_BY_ID } from './geometry.js';
import { FACTION_LOOK, REGION_TREAT, UNIT_NAME, tileOf, treatName, type SlPlayer, type SlTable, type UnitLocation } from './read.js';
import type { UnitKey } from './art.js';

const COLOR_OF = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];

/** Where a unit is, in words: "red space · Fudge’s land". */
export function placeWords(table: SlTable, loc: UnitLocation | null): string {
  const tile = tileOf(loc);
  if (!tile || !loc) return 'off the board';
  if (tile === 'castle') return 'in the Candy Castle';
  const t = TILE_BY_ID[tile];
  if (!t) return 'off the board';
  const land = landWords(table, t.region);
  if (loc.zone === 'start') return table.me?.homeRegion === t.region ? 'at home (start tile)' : `at home (start tile) · ${land}`;
  if (loc.zone === 'treat') {
    const treat = loc.slotKind === 'random' ? table.randomTreat[t.region] : REGION_TREAT[t.region];
    return `on the ${treatName(treat)} treat · ${land}`;
  }
  const color = t.space?.color ?? COLOR_OF[(loc.ringIndex ?? loc.roadIndex ?? 0) % 6]!;
  return loc.zone === 'road' ? `${color} road space · ${land}` : `${color} space · ${land}`;
}

export function pieceTitle(table: SlTable, p: SlPlayer, u: UnitKey): string {
  const owner = p.isMe ? 'Your' : `${p.faction ? FACTION_LOOK[p.faction].short : p.name}’s`;
  return `${owner} ${UNIT_NAME[u]} — ${placeWords(table, p.units[u])}`;
}

interface PieceProps {
  player: SlPlayer;
  unit: UnitKey;
  size: number;
  title: string;
  focused?: boolean;
  /** on the board: "pid:unit", which the hops (motion.ts) animate by */
  pieceId?: string;
  onClick?: () => void;
}

export function Piece({ player, unit, size, title, focused, pieceId, onClick }: PieceProps) {
  const cls = `sl-piece${focused ? ' focused' : ''}`;
  const art = player.faction
    ? <PieceArt faction={player.faction} unit={unit} size={size} />
    : <span className="sl-piece-plain" style={{ width: size, height: size }}>{UNIT_NAME[unit].charAt(0)}</span>;
  if (onClick) {
    return (
      <button type="button" className={cls} style={{ width: size, height: size }} title={title} aria-label={title} aria-pressed={!!focused} data-piece={pieceId} onClick={onClick}>
        {art}
      </button>
    );
  }
  return <span className={cls} style={{ width: size, height: size }} title={title} data-piece={pieceId}>{art}</span>;
}
