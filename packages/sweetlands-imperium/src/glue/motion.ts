// Motion on the candy board (build item 9). A piece that moves hops space by
// space along the path the engine listed for the move (LegalMove.landing),
// turning onto the road at the crossroads when that is where the path goes. A
// move whose path the screen was not given (another seat's, a capture sending
// a piece home, a treat card) is one lifted arc from where the piece was to
// where it is. Nothing here says where a piece goes; the view already has it
// there, and this only animates the getting there.

import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { GlueInput, LegalMove } from '@zekel/glue-kit';
import { landingOf } from './turn.js';
import { tileOf, UNITS, type SlTable } from './read.js';

const HOP_MS = 130;
const ARC_MS = 460;

/** The listed move this seat made, if the view's move is one of the ones it was offered. */
function listedMoveFor(engineMove: Record<string, unknown> | null, offered: LegalMove[]): LegalMove | null {
  if (!engineMove) return null;
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  return offered.find((m) => same(m.move, engineMove))
    ?? offered.find((m) => !!m.move_id && m.move_id === engineMove['move_id'])
    ?? null;
}

/** The centre of a tile in the board's own (unscaled) units. */
function centreOf(board: HTMLElement, tile: string): { x: number; y: number } | null {
  const el = board.querySelector<HTMLElement>(`[data-tile="${tile}"]`);
  if (!el) return null;
  return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 };
}

/** The tiles a piece passes, in order, for a move the engine described; empty when it did not. */
export function hopTiles(listed: LegalMove | null, unit: string): string[] {
  const l = listed ? landingOf(listed) : null;
  if (!l || l.piece !== unit) return [];
  const tiles: string[] = [];
  for (const loc of l.path) {
    const t = tileOf(loc);
    if (t && tiles[tiles.length - 1] !== t) tiles.push(t);
  }
  return tiles;
}

export function usePieceHops(boardBox: RefObject<HTMLDivElement | null>, table: SlTable | null, input: GlueInput, reduced: boolean): void {
  const placed = useRef<Map<string, string>>(new Map());
  const offered = useRef<LegalMove[]>([]);
  useLayoutEffect(() => {
    const board = boardBox.current?.querySelector<HTMLElement>('.sl-board');
    const before = placed.current;
    const now = new Map<string, string>();
    for (const p of table?.players ?? []) {
      for (const u of UNITS) {
        const t = tileOf(p.units[u]);
        if (t) now.set(`${p.pid}:${u}`, t);
      }
    }
    const listed = input.actorPlayerId === input.playerId ? listedMoveFor(input.engineMove, offered.current) : null;
    placed.current = now;
    // The table can show no moves while one is in flight: keep the last list offered.
    if (input.legalMoves.length > 0) offered.current = input.legalMoves;
    if (!board || before.size === 0 || typeof Element.prototype.animate !== 'function') return;
    for (const [id, tile] of now) {
      const was = before.get(id);
      if (!was || was === tile) continue;
      const el = board.querySelector<HTMLElement>(`[data-piece="${id}"]`);
      const end = centreOf(board, tile);
      const start = centreOf(board, was);
      if (!el || !end || !start) continue;
      // Reduced motion: movement becomes a fade, as everywhere on the table.
      if (reduced) { el.animate([{ opacity: 0.15 }, { opacity: 1 }], { duration: ARC_MS }); continue; }
      const unit = id.slice(id.indexOf(':') + 1);
      const path = hopTiles(listed, unit);
      const stops = [start, ...path.map((t) => centreOf(board, t)).filter((c): c is { x: number; y: number } => !!c)];
      if (path.length === 0 || path[path.length - 1] !== tile) stops.push(end);
      const at = (c: { x: number; y: number }, lift = 0, scale = 1) => ({ transform: `translate(${c.x - end.x}px, ${c.y - end.y - lift}px) scale(${scale})` });
      const frames: Keyframe[] = [];
      if (stops.length <= 2) {
        // One lifted arc: up from where it was, over, and down where it is.
        const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        frames.push(at(start), at(mid, 26, 1.18), at(end));
        el.animate(frames, { duration: ARC_MS, easing: 'cubic-bezier(0.3, 0.8, 0.4, 1)' });
      } else {
        // Hop space by space: a small lift between each pair of spaces.
        stops.forEach((c, i) => {
          if (i > 0) {
            const prev = stops[i - 1]!;
            frames.push(at({ x: (prev.x + c.x) / 2, y: (prev.y + c.y) / 2 }, 10, 1.12));
          }
          frames.push(at(c));
        });
        el.animate(frames, { duration: Math.min(1800, HOP_MS * (stops.length - 1)), easing: 'linear' });
      }
    }
  }, [boardBox, table, input, reduced]);
}
