// The Sweetlands Imperium table in its candy theme: a game-drawn screen
// (docs/games/sweetlands-candy-theme-build.md). The plan's zones stay the
// engine debug client's shape; this screen draws the same view its own way.
// Every move it sends is one the engine listed.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useReducedMotion, type SelectEvent } from '@zekel/primitives';
import type { GlueInput, LegalMove } from '@zekel/glue-kit';
import type { PhoneScreenProps } from './phone.js';
import { PhoneMenu, ScoreChips, ZoomBar, useUnderBoard, type MenuTab } from './PhoneParts.js';
import { Board, type Zoom, type ZoomAt } from './Board.js';
import { Piece, pieceTitle } from './Piece.js';
import { Players } from './Players.js';
import { Hand } from './Hand.js';
import { StepTracker, TurnPanel, readBattle } from './TurnPanel.js';
import { ColorGuide } from './ColorGuide.js';
import { FirstGame, howToPlaySeen, markHowToPlaySeen } from './FirstGame.js';
import { cardChoices, turnStep, type PlayOption } from './turn.js';
import { readTable, tileOf, UNITS, type SlCard, type SlTable } from './read.js';
import { TILE_BY_ID } from './geometry.js';
import { usePieceHops } from './motion.js';
import { asArr, asStr, isObj } from '@zekel/glue-kit';
import { sweetlandsGlue } from './index.js';
import './sl.css';

/** Every piece on the board, by the tile it stands on. Pieces go two to a row. */
function piecesOn(table: SlTable, focus: string | null, onFocus: (id: string) => void): Record<string, ReactNode[]> {
  const out: Record<string, ReactNode[]> = {};
  for (const p of table.players) {
    for (const u of UNITS) {
      const tile = tileOf(p.units[u]);
      if (!tile) continue;
      const id = `${p.pid}:${u}`;
      (out[tile] ??= []).push(
        <Piece
          key={id} player={p} unit={u} size={25} pieceId={id}
          title={pieceTitle(table, p, u)} focused={focus === id} onClick={() => onFocus(id)}
        />,
      );
    }
  }
  return out;
}

/** The numbered outline on each destination: dashed while choosing, solid once chosen. */
function marksFor(options: PlayOption[], chosen: number | null, onChoose: (n: number) => void): Record<string, ReactNode> {
  const byTile = new Map<string, PlayOption[]>();
  for (const o of options) {
    if (!o.tile || (chosen !== null && o.n !== chosen)) continue;
    byTile.set(o.tile, [...(byTile.get(o.tile) ?? []), o]);
  }
  const out: Record<string, ReactNode> = {};
  for (const [tile, os] of byTile) {
    out[tile] = (
      <span className={`sl-mark${chosen !== null ? ' chosen' : ''}`}>
        {os.map((o, j) => (
          <button key={o.n} type="button" className="sl-mark-n" style={{ right: -10 + j * 20 }} aria-label={`Option ${o.n}: ${o.title}`} onClick={(e) => { e.stopPropagation(); onChoose(o.n); }}>
            {o.n}
          </button>
        ))}
      </span>
    );
  }
  return out;
}

/** The card in this seat's hand that the move on screen played, read from the hand before it. */
function justPlayed(input: GlueInput): SlCard | null {
  const m = input.engineMove;
  if (!m || input.actorPlayerId !== input.playerId) return null;
  const ids = m['type'] === 'play_intel' ? [asStr(m['cardId'])] : m['type'] === 'discard_for_color' ? asArr(m['cardIds']).map((x) => asStr(x)) : [];
  const before = isObj(input.previous) ? asArr(input.previous['your_hand']).filter(isObj) : [];
  const c = before.find((x) => x['card_id'] === ids[ids.length - 1]);
  if (!c) return null;
  return { cardId: asStr(c['card_id']), kind: c['kind'] === 'double' ? 'double' : c['kind'] === 'treat' ? 'treat' : 'single', color: asStr(c['color']), treat: asStr(c['treat']) };
}

export function SlScreen(props: PhoneScreenProps) {
  const { input, yourTurn, busy, interactive, onMove, onForm, onDraw, menu, nameFor, sideSlot, phone, openMenu, menuSlot } = props;
  const table = useMemo(() => readTable(input), [input]);
  const lit = useMemo(() => (interactive && yourTurn ? sweetlandsGlue.litParts(input) : []), [input, interactive, yourTurn]);
  /** the piece being looked at ("p2:knight"): ringed on the board and in the players panel */
  const [focus, setFocus] = useState<string | null>(null);
  /** the card picked from the hand (its engine card id), or an Intel token ("token:blue") */
  const [picked, setPicked] = useState<string | null>(null);
  /** the numbered option chosen for the picked card */
  const [chosen, setChosen] = useState<number | null>(null);
  /** a foe battle waiting for its Roll */
  const [arming, setArming] = useState<LegalMove | null>(null);
  /** a template that still asks something (Cheesecake's treat slot) */
  const [template, setTemplate] = useState<LegalMove | null>(null);
  /** the battle the engine last resolved, and the one this seat has already seen */
  const battle = useMemo(() => readBattle(input.view), [input.view]);
  const [seenBattle, setSeenBattle] = useState<number>(() => battle?.id ?? 0);
  /** the How to play page: shown by itself before a seat's first Sweetlands game here */
  const [howTo, setHowTo] = useState(false);
  /** the phone's zoom: the whole board or one land */
  const [zoom, setZoomOnly] = useState<Zoom>('all');
  /** the square a choice's zoom centres on: where the piece lands */
  const [zoomAt, setZoomAt] = useState<ZoomAt | null>(null);
  const setZoom = (z: Zoom, at: ZoomAt | null = null) => { setZoomOnly(z); setZoomAt(at); };
  /** the phone menu's tab, kept while the menu is closed */
  const [menuTab, setMenuTab] = useState<MenuTab>('players');
  /** the trade-in's sheets, opened from the hand (desktop) or the turn panel (phone) */
  const [trading, setTrading] = useState(false);
  const main = useRef<HTMLDivElement>(null);
  usePieceHops(main, table, input, useReducedMotion());
  useUnderBoard(main, !!phone && !!table);
  // On a phone the How to play page goes at the end of the table, so it comes
  // after (and over) the menu sheet it can be opened from.
  const [shell, setShell] = useState<HTMLElement | null>(null);
  useEffect(() => { setShell(phone ? main.current?.closest<HTMLElement>('.table-shell') ?? null : null); }, [phone, table]);
  // The card this seat last played, so it can fly onto the discard pile.
  const lastPlayed = useRef<SlCard | null>(null);
  const played = justPlayed(input);
  if (played) lastPlayed.current = played;
  const seated = !!table?.me && interactive;
  useEffect(() => { if (seated && !howToPlaySeen()) setHowTo(true); }, [seated]);

  const step = table ? turnStep(table, input.legalMoves, interactive && yourTurn) : 'waiting';
  const choices = useMemo(
    () => (table && picked && step === 'play' ? cardChoices(table, input.legalMoves, picked) : { options: [], extra: [] }),
    [table, picked, step, input.legalMoves],
  );
  // A new view can make a pick stale (the card was played, the step moved on).
  useEffect(() => {
    if (!picked) return;
    if (step === 'play' && choices.options.length + choices.extra.length > 0) return;
    setPicked(null); setChosen(null); setArming(null);
  }, [picked, step, choices]);

  if (!table) return null;
  const onFocus = (id: string) => setFocus((f) => (f === id ? null : id));
  const pressable = interactive && yourTurn && !busy;
  const onSelect = (sel: SelectEvent) => {
    if (!pressable) return;
    const moves = sweetlandsGlue.movesForSelect!(sel, input);
    if (moves.length === 1) onMove(moves[0]!);
  };
  const pickedColor = picked?.startsWith('token:') ? picked.slice(6) : table.hand?.find((c) => c.cardId === picked)?.color || null;
  // Putting the card back zooms the phone's board out again; a move sent keeps
  // the zoom, so the piece is seen landing.
  const pick = (id: string | null, sent = false) => { setPicked(id); setChosen(null); setArming(null); if (id === null && !sent) setZoom('all'); };
  /** Zoom the phone's board to the land a tile is in, centred on the tile so
   *  it is in view even at the land's edge; the castle is no land's: All. */
  const zoomToTile = (tile: string | null) => {
    const t = tile ? TILE_BY_ID[tile] : undefined;
    setZoom(t ? t.region : 'all', t ? { row: t.row, col: t.col } : null);
  };
  // Choosing a numbered option zooms the phone's board to where the piece lands.
  const choose = (n: number | null) => {
    setChosen(n);
    if (phone && n !== null) zoomToTile(choices.options[n - 1]?.tile ?? null);
  };
  const trades = input.legalMoves.filter((m) => m.move['type'] === 'discard_for_color');
  const involved = (pid: string | null) => !!pid && pid === table.me?.pid;
  const shownBattle = battle && battle.id > seenBattle && (involved(battle.attacker.pid) || involved(battle.defender.pid)) ? battle : null;

  const panel = (
    <TurnPanel
      table={table} input={input} step={step} pressable={pressable} busy={busy} nameFor={nameFor}
      onMove={onMove} onDraw={interactive ? onDraw : undefined} formFor={(m) => sweetlandsGlue.formFor!(m, input)} onForm={onForm}
      picked={picked} setPicked={pick} options={choices.options} extra={choices.extra}
      chosen={chosen} setChosen={choose} arming={arming} setArming={setArming}
      battle={shownBattle} onBattleSeen={() => setSeenBattle(battle?.id ?? 0)}
      template={template} setTemplate={setTemplate}
      phone={phone}
      trade={phone && trades[0] && table.me ? { need: asArr(trades[0].move['cardIds']).length, open: () => setTrading(true) } : null}
    />
  );
  const turn = (
    <div className="sl-turn">
      <button type="button" className="sl-howto-btn" onClick={() => setHowTo(true)}>How to play</button>
      <StepTracker step={step} />
      {panel}
      <ColorGuide highlight={pickedColor} />
    </div>
  );

  const board = (
    <Board
      table={table} pieces={piecesOn(table, focus, onFocus)} lit={lit}
      marks={marksFor(choices.options, chosen, choose)}
      onTile={(id) => onSelect({ component: 'map', id, label: id })}
      zoom={phone ? zoom : undefined} zoomAt={zoomAt}
    />
  );
  const hand = table.me && (
    <Hand
      table={table} input={input} picked={picked?.startsWith('token:') ? null : picked} onPick={pick} discardTop={lastPlayed.current}
      pressable={pressable && step === 'play'}
      formFor={(m) => sweetlandsGlue.formFor!(m, input)} onForm={onForm}
      phone={phone} trading={trading} onTrading={setTrading}
    />
  );
  const howToPage = howTo && <FirstGame input={input} phone={phone} onClose={() => { markHowToPlaySeen(); setHowTo(false); }} />;

  if (phone) {
    /** Find, in the menu: ring the piece and zoom to it. */
    const find = (id: string) => {
      setFocus(id);
      const [pid, unit] = id.split(':') as [string, (typeof UNITS)[number]];
      zoomToTile(tileOf(table.players.find((p) => p.pid === pid)?.units[unit]));
    };
    // The phone (docs/design/sweetlands-candy/Phone-Table.dc.html): one
    // column, the board always in view; what the side column holds on a
    // desktop is in the table's menu.
    return (
      <div className="sl-screen phone" ref={main}>
        <ScoreChips table={table} onOpen={openMenu && (() => { setMenuTab('players'); openMenu(); })} />
        <ZoomBar table={table} zoom={zoom} onZoom={(z) => setZoom(z)} />
        {board}
        <div className="sl-under">
          {panel}
          {/* A battle takes the hand's place too (Phone-Battle.dc.html); never the board's. */}
          {!shownBattle && !arming && hand}
        </div>
        {menuSlot && createPortal(
          <PhoneMenu
            table={table} input={input} tab={menuTab} onTab={setMenuTab} focus={focus} onFind={find}
            nameFor={nameFor} onWholePage={() => setHowTo(true)}
          />,
          menuSlot,
        )}
        {howToPage && (shell ? createPortal(howToPage, shell) : howToPage)}
      </div>
    );
  }

  return (
    <div className={`sl-screen${sideSlot ? '' : ' with-right'}`}>
      <Players table={table} focus={focus} onFocus={onFocus} nameFor={nameFor} />
      <div className="sl-main" ref={main}>
        {board}
        {hand}
        {menu && <div className="sl-menu">{menu}</div>}
      </div>
      {sideSlot ? createPortal(turn, sideSlot) : turn}
      {howToPage}
    </div>
  );
}
