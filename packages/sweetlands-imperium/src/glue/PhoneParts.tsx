// The parts only the phone draws (docs/design/sweetlands-candy/Phone-*.dc.html):
// the score chips above the board, the five zoom buttons, and the zoom itself.
// None of it is a rule or a move: the chips read the view, and zooming only
// changes what part of the board is on screen.

import { useLayoutEffect, type RefObject } from 'react';
import type { GlueInput } from '@zekel/glue-kit';
import { TreatChip } from './art.js';
import { ColorGuide } from './ColorGuide.js';
import { goals } from './FirstGame.js';
import { Players } from './Players.js';
import { FACTION_LOOK, LAND_EDGE, REGION_HOME, type SlTable } from './read.js';
import { REGIONS } from './geometry.js';
import type { Zoom } from './Board.js';

/** One chip per seat: the faction's treat, "2/5", a five-segment bar. The row
 *  is one button that opens the players in the menu. */
export function ScoreChips({ table, onOpen }: { table: SlTable; onOpen?: () => void }) {
  const toWin = table.pointsToWin ?? 5;
  const order = [...table.players.filter((p) => p.isMe), ...table.players.filter((p) => !p.isMe)];
  const said = order.map((p) => `${p.isMe ? 'you' : p.faction ? FACTION_LOOK[p.faction].short : p.name} ${p.points} of ${toWin}`).join(', ');
  return (
    <button type="button" className="sl-chips" aria-label={`Scores. Open the players: ${said}`} onClick={onOpen} disabled={!onOpen}>
      {order.map((p) => {
        const filled = Math.min(p.points, toWin);
        const fill = p.homeRegion ? LAND_EDGE[p.homeRegion] : '#2c2c2c';
        return (
          <span key={p.pid} className={`sl-chip${p.isMe ? ' me' : ''}${p.active ? ' active' : ''}`} aria-hidden="true">
            {p.faction ? <TreatChip faction={p.faction} size={20} /> : <span className="sl-chip-plain" />}
            <span className="sl-chip-n">{p.points}/{toWin}</span>
            <span className="sl-chip-bar">
              {Array.from({ length: toWin }, (_, i) => (
                <span key={i} className={i < filled ? 'on' : undefined} style={i < filled ? { backgroundColor: fill } : undefined} />
              ))}
            </span>
          </span>
        );
      })}
    </button>
  );
}

/** "All", "Yours", then the other lands by their faction's short name. A seat
 *  without a home (the Nomads, not designed yet) gets every land instead of
 *  "Yours". */
export function ZoomBar({ table, zoom, onZoom }: { table: SlTable; zoom: Zoom; onZoom(z: Zoom): void }) {
  const home = table.me?.homeRegion ?? null;
  const lands = REGIONS.filter((r) => r !== home);
  const button = (z: Zoom, name: string, faction: keyof typeof FACTION_LOOK | null, label = name) => (
    <button key={String(z)} type="button" className={zoom === z ? 'on' : undefined} aria-pressed={zoom === z} aria-label={label} onClick={() => onZoom(z)}>
      {faction ? <TreatChip faction={faction} size={16} /> : <span className="sl-zoom-all" aria-hidden="true" />}
      <span>{name}</span>
    </button>
  );
  return (
    <div className="sl-zoom" role="group" aria-label="Zoom the board">
      {button('all', 'All', null, 'All')}
      {home && button(home, 'Yours', REGION_HOME[home], `Yours (${FACTION_LOOK[REGION_HOME[home]].short}’s land)`)}
      {lands.map((r) => button(r, FACTION_LOOK[REGION_HOME[r]].short, REGION_HOME[r], `${FACTION_LOOK[REGION_HOME[r]].short}’s land`))}
    </div>
  );
}

/**
 * Tell the table where the board ends (--sl-under-board on the table shell,
 * in px from the top of the viewport), so the menu sheet starts under the
 * board and the board stays in view with the menu open (Phone-Menu.dc.html).
 */
export function useUnderBoard(column: RefObject<HTMLElement | null>, on: boolean): void {
  useLayoutEffect(() => {
    const col = column.current;
    const shell = col?.closest<HTMLElement>('.table-shell');
    if (!on || !col || !shell) return;
    const measure = () => {
      const fit = col.querySelector('.sl-board-fit');
      if (fit) shell.style.setProperty('--sl-under-board', `${Math.round(fit.getBoundingClientRect().bottom)}px`);
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(col);
    const fit = col.querySelector('.sl-board-fit');
    if (fit) ro?.observe(fit);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
      shell.style.removeProperty('--sl-under-board');
    };
  }, [column, on]);
}

export type MenuTab = 'players' | 'howto';

/** What the side column holds on a desktop, in the table's menu sheet: a
 *  Players tab and a How to play tab (Phone-Menu.dc.html). */
export function PhoneMenu({ table, input, tab, onTab, focus, onFind, nameFor, onWholePage }: {
  table: SlTable; input: GlueInput; tab: MenuTab; onTab(t: MenuTab): void;
  focus: string | null; onFind(id: string): void; nameFor(pid: string): string; onWholePage(): void;
}) {
  const toWin = goals(input).toWin;
  return (
    <div className="sl-phone-menu">
      <div className="sl-tabs">
        <button type="button" className="sl-tab" aria-pressed={tab === 'players'} onClick={() => onTab('players')}>Players</button>
        <button type="button" className="sl-tab" aria-pressed={tab === 'howto'} onClick={() => onTab('howto')}>How to play</button>
      </div>
      {tab === 'players' ? (
        <Players table={table} focus={focus} onFocus={onFind} nameFor={nameFor} find />
      ) : (
        <div className="sl-menu-howto">
          <p>
            A card moves <b>one</b> of your pieces forward to the <b>next space of its color</b>, however far that is,
            then lets you take that color’s action. Pieces travel counter-clockwise; at a crossroads you may turn
            onto the road to the Candy Castle.
          </p>
          <ColorGuide highlight={null} />
          <p>{toWin ? `The first to ${toWin} points wins.` : 'Score points to win.'} Each goal scores once per player.</p>
          <button type="button" className="sl-quiet-choice" onClick={onWholePage}>The whole game on one page</button>
        </div>
      )}
    </div>
  );
}
