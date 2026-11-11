// The Word Debauchee table as a game-drawn screen: one centered column
// (docs/design/word-debauchee/). The debauchee's seat gets the secret and its
// decisions; a guesser gets the build area and the pool as a keyboard. The
// top bar, the caption, the log and playback stay the table's. Every move the
// screen sends is one the engine listed, sent as listed or completed with the
// fields the engine's own move names (index, to_row, to_index, check, text),
// and only because the person pressed something. Plan: implementation-plan §20.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { GameScreenProps, LegalMove } from '@zekel/glue-kit';
import { asArr, asStr, isObj } from '@zekel/glue-kit';
import {
  KEY_ROWS, find, isTemplate, moveMove, nameOf, placeMove, playMove, readTable, typeOf,
  type RoundResult, type WdTable,
} from './read.js';
import './wd.css';

type Send = (listed: LegalMove, extra: Record<string, unknown>, keys: string[]) => void;

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** One tile lifted along an arc from `from` to where `el` now sits. */
function fly(el: Element | null, from: DOMRect | null | undefined): void {
  if (!el || !from || typeof (el as HTMLElement).animate !== 'function') return;
  const to = el.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
  if (reduced()) { (el as HTMLElement).animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320 }); return; }
  (el as HTMLElement).animate([
    { transform: `translate(${dx}px, ${dy}px)`, boxShadow: '0 2px 4px rgba(28,26,23,.2)' },
    { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 14}px) scale(1.08)`, boxShadow: '0 14px 22px rgba(28,26,23,.3)', offset: 0.55 },
    { transform: 'none', boxShadow: '0 2px 4px rgba(28,26,23,0)' },
  ], { duration: 320, easing: 'ease-out' });
}

// ---- reading what changed between two views -----------------------------------

type Edit = { kind: 'add'; row: number; index: number; letter: string } | { kind: 'move'; from: [number, number]; row: number; index: number };

const without = (rows: string[], r: number, i: number): string[] =>
  rows.map((t, k) => (k === r ? t.slice(0, i) + t.slice(i + 1) : t)).filter((t) => t !== '');
const same = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

/** The one tile that arrived or moved between two build areas, if that is what happened. */
export function editBetween(before: string[], after: string[]): Edit | null {
  const count = (rows: string[]) => rows.reduce((n, t) => n + t.length, 0);
  if (count(after) === count(before) + 1) {
    for (let r = 0; r < after.length; r++) for (let i = 0; i < after[r]!.length; i++) {
      if (same(without(after, r, i), before)) return { kind: 'add', row: r, index: i, letter: after[r]![i]! };
    }
  }
  if (count(after) === count(before) && !same(after, before)) {
    for (let r1 = 0; r1 < before.length; r1++) for (let i1 = 0; i1 < before[r1]!.length; i1++) {
      const rest = without(before, r1, i1);
      for (let r = 0; r < after.length; r++) for (let i = 0; i < after[r]!.length; i++) {
        if (after[r]![i] === before[r1]![i1] && same(without(after, r, i), rest)) return { kind: 'move', from: [r1, i1], row: r, index: i };
      }
    }
  }
  return null;
}

/** Tiles fly: from a key, from where they were, or from the debauchee. Run
 *  once per event, after the new layout is on the page. */
function useMotion(root: RefObject<HTMLDivElement>, seq: number, table: WdTable | null, previous: unknown) {
  const last = useRef<{ seq: number; rects: Map<string, DOMRect> }>({ seq: -1, rects: new Map() });
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const before = last.current;
    const flights: Array<[Element | null, DOMRect | null | undefined]> = [];
    const prev = before.seq !== seq ? readTable(previous) : null;
    const key = (l: string) => el.querySelector(`[data-key="${l}"]`)?.getBoundingClientRect();
    if (prev?.round && table?.round && prev.round.number === table.round.number) {
      const edit = editBetween(prev.round.rows, table.round.rows);
      if (edit) {
        const node = el.querySelector(`[data-cell="${edit.row}:${edit.index}"]`);
        const from = before.rects.get('held') ?? (edit.kind === 'add' ? key(edit.letter) : before.rects.get(`${edit.from[0]}:${edit.from[1]}`));
        flights.push([node, from]);
      }
      const n = table.round.revealed.length;
      if (n === prev.round.revealed.length + 1) {
        const l = table.round.revealed[n - 1]!;
        flights.push([el.querySelector(`[data-reveal="${n - 1}"]`), before.rects.get(`src:${l}`) ?? key(l) ?? el.querySelector(`[data-seat="${table.round.debauchee}"]`)?.getBoundingClientRect()]);
      }
      // A "no" shakes its row once; the row stays.
      const fresh = table.round.checks.slice(prev.round.checks.length).filter((c) => !c.yes);
      for (const c of fresh) {
        const at = table.round.rows.indexOf(c.word);
        if (at >= 0 && !reduced()) el.querySelector(`[data-row="${at}"]`)?.animate?.([
          { transform: 'none' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(-3px)' }, { transform: 'none' },
        ], { duration: 400 });
      }
    }
    // Where everything sits now, before anything moves, for the next event.
    const rects = new Map<string, DOMRect>();
    el.querySelectorAll('[data-cell]').forEach((n) => rects.set((n as HTMLElement).dataset['cell']!, n.getBoundingClientRect()));
    el.querySelectorAll('[data-source]').forEach((n) => rects.set(`src:${(n as HTMLElement).dataset['source']}`, n.getBoundingClientRect()));
    const held = el.querySelector('[data-fresh="1"]');
    if (held) rects.set('held', held.getBoundingClientRect());
    last.current = { seq, rects };
    for (const [node, from] of flights) fly(node, from);
  });
}

// ---- the screen ------------------------------------------------------------------

export function WdScreen(props: GameScreenProps) {
  const { input, yourTurn, busy, interactive, onMove, onForm, menu } = props;
  const table = useMemo(() => readTable(input.view), [input.view]);
  const root = useRef<HTMLDivElement>(null);
  const [help, setHelp] = useState(false);
  useMotion(root, input.seq, table, input.previous);
  if (!table) return null;
  const me = input.playerId;
  const r = table.round;
  const pressable = interactive && yourTurn && !busy;
  const moves = pressable ? input.legalMoves : [];
  const send: Send = (listed, extra, keys) => {
    const changed = Object.keys(extra).filter((k) => JSON.stringify(extra[k]) !== JSON.stringify(listed.move[k]));
    if (changed.length === 0) onMove(listed);
    else onForm(listed, { ...listed.move, ...extra }, keys);
  };
  const deb = r ? nameOf(table, r.debauchee, me) : '';
  const isDeb = !!r && r.debauchee === me;
  const showResult = !!table.lastRound && (table.phase === 'game_over' || (!!r && r.number === table.lastRound.number + 1 && table.phase !== 'build' && table.phase !== 'reveal'));

  let body: ReactNode;
  if (table.phase === 'setup') body = <FirstDebauchee table={table} moves={moves} me={me} onMove={onMove} />;
  else if (table.phase === 'game_over') body = <History table={table} me={me} />;
  else if (!r) body = null;
  else if (isDeb) body = <DebaucheeSide table={table} moves={moves} me={me} onMove={onMove} send={send} reference={input.reference?.referenceData} />;
  else body = <GuesserSide seq={input.seq} table={table} moves={moves} me={me} send={send} onMove={onMove} pressable={pressable} />;

  return (
    <div className="wd-screen" ref={root}>
      <div className="wd-col">
        <div className="wd-top">
          <Seats table={table} me={me} />
          <button type="button" className="wd-btn quiet" style={{ marginLeft: 'auto' }} onClick={() => setHelp((v) => !v)} aria-expanded={help}>How to play</button>
        </div>
        {help && <HowToPlay table={table} me={me} reference={input.reference?.referenceData} />}
        {showResult && table.lastRound && <Result result={table.lastRound} table={table} me={me} />}
        {r && table.phase !== 'game_over' && !isDeb && table.phase !== 'build' && table.phase !== 'reveal' && (
          <p className="wd-help" aria-live="polite">{waitingWords(table, deb)}</p>
        )}
        {body}
        {yourTurn && menu}
      </div>
    </div>
  );
}

function waitingWords(table: WdTable, deb: string): string {
  switch (table.phase) {
    case 'choose_word': return `${deb} is choosing a secret word from three cards.`;
    case 'play_clues': return `${deb} is choosing three clues to play.`;
    case 'answer_clues': return `${deb} is answering a clue in their own words.`;
    default: return table.phaseText;
  }
}

// ---- shared parts ------------------------------------------------------------------

function Seats({ table, me }: { table: WdTable; me: string | null }) {
  const r = table.round;
  const now = !r ? null : table.phase === 'build' ? r.turn : table.phase === 'game_over' ? null : r.debauchee;
  return (
    <div className="wd-seats" aria-label="Seats and scores">
      {table.seats.map((s) => {
        const role = [r?.debauchee === s.id ? (table.settings.house === s.id ? 'the house' : 'debauchee') : '', s.ai && s.id !== me && !/^AI\b/.test(s.name) ? 'AI' : ''].filter(Boolean).join(' · ');
        return (
          <div key={s.id} data-seat={s.id} className={`wd-seat${s.id === me ? ' you' : s.ai ? ' ai' : ''}${s.id === now ? ' now' : ''}`}>
            <span>{nameOf(table, s.id, me)}</span>
            {role && <span className="wd-lab">{role}</span>}
            <span className="wd-mono">{s.score}</span>
          </div>
        );
      })}
    </div>
  );
}

function Clues({ table }: { table: WdTable }) {
  const clues = table.round?.clues ?? [];
  if (!clues.length) return null;
  return (
    <section aria-label="Clues" className="wd-clues">
      {clues.map((c, i) => (
        <div key={`${c.card}:${i}`} className={`wd-clue${c.bribed ? ' bribed' : ''}`} title={c.asks}>
          <div className="wd-lab">{c.name}{c.bribed ? ' · bribed' : ''}</div>
          {c.answer === null
            ? <div className="wd-clue-val waiting">waiting for an answer</div>
            : <div className="wd-clue-val">{String(c.answer)}</div>}
        </div>
      ))}
    </section>
  );
}

function Letters({ table, me }: { table: WdTable; me: string | null }) {
  const r = table.round!;
  const deb = nameOf(table, r.debauchee, me);
  const u = r.turnsUntilReveal;
  const when = u === null ? null : u <= 0 ? 'now' : u === 1 ? 'after this turn' : `in ${u} turns`;
  return (
    <section className="wd-letters" aria-label={`Letters ${deb === 'You' ? 'you have' : `${deb} has`} laid down`}>
      <div className="wd-letters-row">
        {r.revealed.length === 0 && <span className="wd-lab">No letters down yet</span>}
        {r.revealed.map((ch, i) => <div key={i} className="wd-tile lay" data-reveal={i}>{ch}</div>)}
      </div>
      <div className="wd-letters-note">
        <strong>{r.revealsForScoring === 0 ? 'A word pays its full length' : `A word pays its length − ${r.revealsForScoring}`}</strong>
        {when && table.phase === 'build' && <span className="wd-lab" style={{ fontWeight: 400 }}>{deb === 'You' ? 'You lay down' : `${deb} lays down`} another letter {when}</span>}
      </div>
    </section>
  );
}

/** The tag a row carries: a "no" the engine gave this round, or a burned word. */
function rowTag(table: WdTable, text: string): { tag: string; no: boolean } {
  const r = table.round!;
  if (r.burned.includes(text.toLowerCase())) return { tag: "can't score", no: true };
  if (r.checks.some((c) => !c.yes && c.word.toUpperCase() === text)) return { tag: 'no', no: true };
  return { tag: '', no: false };
}

function StaticBuild({ table }: { table: WdTable }) {
  const r = table.round!;
  return (
    <section aria-label="Build area" className="wd-build">
      {r.rows.length === 0 && <div className="wd-empty">Nothing built yet.</div>}
      {r.rows.map((t, ri) => {
        const { tag, no } = rowTag(table, t);
        return (
          <div key={ri} className="wd-row static" data-row={ri}>
            {t.split('').map((ch, i) => <div key={i} className="wd-tile" data-cell={`${ri}:${i}`}>{ch}</div>)}
            <span className={`wd-tag${no ? ' no' : ''}`}>{tag}</span>
          </div>
        );
      })}
      <Burned table={table} />
    </section>
  );
}

function Burned({ table }: { table: WdTable }) {
  const b = table.round?.burned ?? [];
  if (!b.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', padding: '6px 4px 0' }}>
      <span className="wd-lab">Said out loud, can't score:</span>
      {b.map((w) => <span key={w} className="wd-burnt">{w}</span>)}
    </div>
  );
}

function Keyboard({ pool, disabled, onPress }: { pool: Record<string, number>; disabled: boolean; onPress?: (l: string) => void }) {
  return (
    <div className="wd-keys" role="group" aria-label="The pool">
      {KEY_ROWS.map((row) => (
        <div key={row} className="wd-keyrow">
          {row.split('').map((l) => {
            const n = pool[l] ?? 0;
            return (
              <button key={l} type="button" className="wd-key" data-key={l} disabled={disabled || n <= 0 || !onPress} onClick={() => onPress?.(l)} aria-label={`${l}, ${n} left`}>
                {l}<span className="n">{n}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ---- the guesser ------------------------------------------------------------------

type Held = { kind: 'pool'; letter: string } | { kind: 'tile'; row: number; index: number; letter: string };
type Target = { row: number | null; index: number | null };
interface Cell { ch: string; o: number | null; fresh?: boolean; lifted?: boolean }

function GuesserSide({ seq, table, moves, me, send, onMove, pressable }: { seq: number; table: WdTable; moves: LegalMove[]; me: string | null; send: Send; onMove: (m: LegalMove) => void; pressable: boolean }) {
  const r = table.round!;
  const mine = pressable && table.phase === 'build' && r.turn === me && moves.some((m) => typeOf(m) === 'place' || typeOf(m) === 'call_reveal');
  // What the player is putting together belongs to the event on screen: a new
  // event clears it. (The parts stay mounted, so nothing is dealt in again.)
  const blank = { seq, held: null as Held | null, placed: false, target: { row: null, index: null } as Target };
  const [comp, setComp] = useState(blank);
  const live = comp.seq === seq ? comp : blank;
  const { held, placed, target } = live;
  const setHeld = (h: Held | null) => setComp((c) => ({ ...(c.seq === seq ? c : blank), held: h }));
  const setPlaced = (v: boolean) => setComp((c) => ({ ...(c.seq === seq ? c : blank), placed: v }));
  const setTarget = (t: Target) => setComp((c) => ({ ...(c.seq === seq ? c : blank), target: t }));
  const root = useRef<HTMLDivElement>(null);
  const flyFrom = useRef<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!flyFrom.current) return;
    fly(root.current?.querySelector('[data-fresh="1"]') ?? null, flyFrom.current);
    flyFrom.current = null;
  });

  const showing = held && (held.kind === 'pool' || placed) ? held.letter : null;
  // The rows as they would stand with what the player is holding put down.
  const layout: Array<{ ri: number | null; cells: Cell[] }> = r.rows.map((t, ri) => ({ ri, cells: t.split('').map((ch, o) => ({ ch, o })) }));
  if (held?.kind === 'tile') {
    const cells = layout[held.row]!.cells;
    const at = cells.findIndex((c) => c.o === held.index);
    if (placed) cells.splice(at, 1); else cells[at] = { ...cells[at]!, lifted: true };
  }
  if (showing) {
    if (target.row === null) layout.push({ ri: null, cells: [{ ch: showing, o: null, fresh: true }] });
    else {
      const cells = layout[target.row]!.cells;
      const at = target.index === null ? -1 : cells.findIndex((c) => c.o !== null && c.o >= target.index!);
      cells.splice(at === -1 ? cells.length : at, 0, { ch: showing, o: null, fresh: true });
    }
  }
  const heldRow = layout.find((row) => row.cells.some((c) => c.fresh));
  const heldWord = heldRow ? heldRow.cells.map((c) => c.ch).join('') : '';
  const burnedHeld = r.burned.includes(heldWord.toLowerCase());

  const caption = !mine
    ? (table.phase === 'reveal' ? `${nameOf(table, r.debauchee, me)} is laying down a letter.` : r.turn ? `${nameOf(table, r.turn, me)}${r.turn === me ? ' are' : ' is'} up.` : '')
    : held?.kind === 'tile' && !placed ? `Moving ${held.letter}. Tap a gap or New row to put it somewhere else, or send it back to the pool.`
    : showing ? (target.row === null ? `Put ${showing} in a new row?` : `Put ${showing} in ${r.rows[target.row]}?`)
    : target.row !== null ? `Next to ${r.rows[target.row]}. Pick a letter.`
    : 'Your turn. Pick a letter from the pool below, or a tile already in the build area.';

  const reset = () => setComp(blank);
  const press = (l: string) => {
    if (!mine || held?.kind === 'tile') return;
    if ((r.pool[l] ?? 0) <= 0) return;
    flyFrom.current = root.current?.querySelector(`[data-key="${l}"]`)?.getBoundingClientRect() ?? null;
    setHeld({ kind: 'pool', letter: l });
  };
  const pick = (row: number | null, index: number | null) => {
    if (!mine) return;
    const was = root.current?.querySelector(held?.kind === 'tile' && !placed ? '[data-lifted="1"]' : '[data-fresh="1"]')?.getBoundingClientRect() ?? null;
    if (held) flyFrom.current = was;
    setComp((c) => ({ ...(c.seq === seq ? c : blank), target: { row, index }, placed: c.seq === seq && c.held?.kind === 'tile' ? true : c.placed }));
  };
  const lift = (row: number, index: number) => {
    if (!mine || held?.kind === 'pool') return;
    if (held?.kind === 'tile' && held.row === row && held.index === index) { reset(); return; }
    setComp({ ...blank, held: { kind: 'tile', row, index, letter: r.rows[row]![index]! } });
  };

  const commit = (check: boolean) => {
    if (!held || !showing) return;
    if (held.kind === 'pool') {
      const listed = placeMove(moves, held.letter, target.row);
      if (!listed) return;
      const extra: Record<string, unknown> = {};
      if (target.row !== null && target.index !== null && target.index !== r.rows[target.row]!.length) extra['index'] = target.index;
      if (check) extra['check'] = true;
      send(listed, extra, ['index', 'check']);
      return;
    }
    const listed = moveMove(moves, held.row);
    if (!listed) return;
    const extra: Record<string, unknown> = { index: held.index, to_row: target.row === null ? 'new' : target.row };
    if (target.row !== null && target.index !== null) {
      // In the same row the engine counts the spot with the tile already lifted out.
      const to = target.row === held.row && target.index > held.index ? target.index - 1 : target.index;
      const len = r.rows[target.row]!.length - (target.row === held.row ? 1 : 0);
      if (to !== len) extra['to_index'] = to;
    }
    if (check) extra['check'] = true;
    send(listed, extra, ['index', 'to_row', 'to_index', 'check']);
  };
  const backToPool = () => {
    if (held?.kind !== 'tile') return;
    const listed = moveMove(moves, held.row);
    if (!listed) return;
    const go = () => send(listed, { index: held.index }, ['index']);
    const el = root.current?.querySelector('[data-lifted="1"]') as HTMLElement | null;
    const keyAt = root.current?.querySelector(`[data-key="${held.letter}"]`)?.getBoundingClientRect();
    if (el && keyAt && typeof el.animate === 'function' && !reduced()) {
      const at = el.getBoundingClientRect();
      el.animate([{ transform: 'translateY(-6px)' }, { transform: `translate(${keyAt.left - at.left}px, ${keyAt.top - at.top}px) scale(.9)` }], { duration: 280, easing: 'ease-in', fill: 'forwards' }).onfinish = go;
      return;
    }
    go();
  };

  // Physical keys: a letter picks a tile, Enter places it, Backspace or Escape undoes.
  useEffect(() => {
    if (!mine) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[a-zA-Z]$/.test(e.key)) { press(e.key.toUpperCase()); e.preventDefault(); return; }
      if (e.key === 'Enter' && showing) { commit(false); e.preventDefault(); return; }
      if ((e.key === 'Backspace' || e.key === 'Escape') && held) { reset(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const reveal = find(moves, (m) => typeOf(m) === 'call_reveal' && m.move['clue'] === undefined);
  const bribes = moves.filter((m) => typeOf(m) === 'call_reveal' && m.move['clue'] !== undefined);
  const verb = held?.kind === 'tile' ? 'Move' : 'Place';
  const poolShown: Record<string, number> = { ...r.pool };
  if (held?.kind === 'pool') poolShown[held.letter] = (poolShown[held.letter] ?? 0) - 1;

  // Until the guessers start building, the round is the debauchee's: the
  // clues as they come, nothing else.
  if (table.phase !== 'build' && table.phase !== 'reveal') return <Clues table={table} />;

  return (
    <div ref={root} style={{ display: 'contents' }}>
      <Clues table={table} />
      <Letters table={table} me={me} />
      {mine ? (
        <section aria-label="Build area" className="wd-build">
          {layout.filter((row) => row.cells.length > 0).map((row) => {
            const ri = row.ri;
            const kids: ReactNode[] = [];
            const gapFree = (g: number) => !(held?.kind === 'tile' && held.row === ri && (g === held.index || g === held.index + 1));
            const gap = (g: number) => {
              const on = ri !== null && target.row === ri && target.index === g && !showing;
              kids.push(<button key={`g${g}`} type="button" className={`wd-gap${on ? ' on' : ''}`} disabled={ri === null || !gapFree(g)} onClick={() => pick(ri, g)} aria-label="Put the tile here" />);
            };
            row.cells.forEach((c, i) => {
              if (ri !== null && c.o !== null) gap(c.o);
              kids.push(
                <button
                  key={`t${i}`} type="button"
                  className={`wd-tile${c.fresh ? ' fresh' : c.lifted ? ' lifted' : ''}`}
                  data-cell={ri !== null && c.o !== null ? `${ri}:${c.o}` : undefined}
                  data-fresh={c.fresh ? '1' : undefined}
                  data-lifted={c.lifted ? '1' : undefined}
                  disabled={!!c.fresh || held?.kind === 'pool'}
                  onClick={() => { if (ri !== null && c.o !== null) lift(ri, c.o); }}
                  aria-label={`${c.ch}${c.fresh ? ', the tile you are placing' : ', tap to move it'}`}
                >{c.ch}</button>,
              );
            });
            const lastCell = row.cells[row.cells.length - 1];
            if (ri !== null && !(lastCell?.fresh && target.index === null)) gap(r.rows[ri]!.length);
            const text = row.cells.map((c) => c.ch).join('');
            const { tag, no } = ri !== null && !row.cells.some((c) => c.fresh || c.lifted) ? rowTag(table, text) : { tag: '', no: false };
            const on = row.cells.some((c) => c.fresh) || (ri !== null && target.row === ri);
            return <div key={ri ?? 'new'} className={`wd-row${on ? ' on' : ''}`} data-row={ri ?? undefined}>{kids}<span className={`wd-tag${no ? ' no' : ''}`}>{tag}</span></div>;
          })}
          {r.rows.length === 0 && !showing && <div className="wd-empty">Nothing built yet. Your tile starts the first row.</div>}
          <button type="button" className={`wd-newrow${target.row === null && !showing ? ' on' : ''}`} onClick={() => pick(null, null)}>New row</button>
          <Burned table={table} />
        </section>
      ) : <StaticBuild table={table} />}

      <div className="wd-turn">
        <div className="wd-caption" aria-live="polite">{caption}</div>
        {mine && (
          <div className="wd-actions">
            {!held && reveal && <button type="button" className="wd-btn" onClick={() => onMove(reveal)} title={reveal.description}>Reveal!</button>}
            {!held && bribes.map((m) => (
              <button key={m.move_id} type="button" className="wd-btn" onClick={() => onMove(m)} title={m.description}>
                Reveal! Take a {asStr(m.move['clue'])} clue
              </button>
            ))}
            {showing && <button type="button" className="wd-btn go" onClick={() => commit(false)}>{verb}</button>}
            {showing && <button type="button" className="wd-btn" disabled={burnedHeld} onClick={() => commit(true)} title={burnedHeld ? `${heldWord} was said out loud this round, so it can't score` : undefined}>{verb} and Check! {heldWord}</button>}
            {held?.kind === 'tile' && !placed && <button type="button" className="wd-btn" onClick={backToPool}>Back to the pool</button>}
            {held && <button type="button" className="wd-btn quiet" onClick={reset}>Undo</button>}
          </div>
        )}
      </div>
      <Keyboard pool={poolShown} disabled={!mine || held?.kind === 'tile'} onPress={mine ? press : undefined} />
    </div>
  );
}

// ---- the debauchee ------------------------------------------------------------------

function SecretPanel({ table }: { table: WdTable }) {
  const s = table.secret;
  if (!s?.word || !s.card) return null;
  const c = s.card;
  const facts = [
    `${c.letters} letter${c.letters === 1 ? '' : 's'}`, `${c.vowels} vowel${c.vowels === 1 ? '' : 's'}`, `${c.consonants} consonant${c.consonants === 1 ? '' : 's'}`,
    `${c.syllables} syllable${c.syllables === 1 ? '' : 's'}`, c.type.toLowerCase(), c.category, `grade ${c.grade}`, c.difficulty,
  ];
  return (
    <div className="wd-secret" aria-label="Your secret word">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="wd-secret-word">{s.word}</span>
        <span className="wd-lab" style={{ color: 'inherit' }}>Only you can see this</span>
      </div>
      <div className="wd-mono" style={{ fontSize: 12, marginTop: 4 }}>{facts.join(' · ')}</div>
      <div style={{ fontSize: 14, marginTop: 8 }}>{c.synonyms.join(' · ')}</div>
    </div>
  );
}

function DebaucheeSide({ table, moves, me, onMove, send, reference }: { table: WdTable; moves: LegalMove[]; me: string | null; onMove: (m: LegalMove) => void; send: Send; reference: unknown }) {
  const r = table.round!;
  switch (table.phase) {
    case 'choose_word': return <ChooseWord table={table} moves={moves} onMove={onMove} />;
    case 'play_clues': return <><SecretPanel table={table} /><PlayClues table={table} moves={moves} onMove={onMove} send={send} reference={reference} /></>;
    case 'answer_clues': return <><SecretPanel table={table} /><Clues table={table} /><AnswerClues table={table} moves={moves} send={send} onMove={onMove} /></>;
    default: {
      const revealing = table.phase === 'reveal';
      // Laying down a letter comes straight after the secret, where it is seen
      // without scrolling however many clues there are.
      return (
        <>
          <SecretPanel table={table} />
          {revealing && <Reveal table={table} moves={moves} onMove={onMove} />}
          <Clues table={table} />
          <Letters table={table} me={me} />
          <StaticBuild table={table} />
          {revealing ? null : (
            <div className="wd-turn">
              <div className="wd-caption" aria-live="polite" style={{ fontWeight: 500 }}>{r.turn ? `${nameOf(table, r.turn, me)} is building.` : 'The guessers are building.'}</div>
              <div className="wd-help">Say nothing. You can smirk.</div>
            </div>
          )}
        </>
      );
    }
  }
}

function ChooseWord({ table, moves, onMove }: { table: WdTable; moves: LegalMove[]; onMove: (m: LegalMove) => void }) {
  const dealt = table.secret?.dealt ?? [];
  const redraw = find(moves, (m) => typeOf(m) === 'redraw');
  const r = table.round!;
  return (
    <div>
      <h2 className="wd-h2">Keep one word</h2>
      <p className="wd-help" style={{ margin: '0 0 14px' }}>Only you can see these. Pick one you know well enough to answer for.{r.redraws > 0 ? ` You have drawn three more ${r.redraws === 1 ? 'once' : `${r.redraws} times`} this round.` : ''}</p>
      <div className="wd-words">
        {dealt.map((w) => {
          const m = find(moves, (x) => typeOf(x) === 'choose_word' && x.move['word'] === w);
          return <button key={`${r.redraws}:${w}`} type="button" className="wd-wordcard" disabled={!m} onClick={() => m && onMove(m)}>{w}</button>;
        })}
      </div>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="wd-btn quiet" disabled={!redraw} onClick={() => redraw && onMove(redraw)}>Know none of them? Draw three more</button>
      </div>
    </div>
  );
}

function PlayClues({ table, moves, onMove, send, reference }: { table: WdTable; moves: LegalMove[]; onMove: (m: LegalMove) => void; send: Send; reference: unknown }) {
  const hand = table.secret?.hand ?? [];
  const [hidden, setHidden] = useState<string | null>(null);
  const template = find(moves, (m) => typeOf(m) === 'play_clues' && isTemplate(m));
  if (template) return <OpenHand template={template} send={send} reference={reference} />;
  const keep = hidden ? hand.filter((c) => c.card !== hidden).map((c) => c.card) : null;
  const play = keep ? playMove(moves, keep) : null;
  return (
    <div>
      <h2 className="wd-h2">Play three clues</h2>
      <p className="wd-help" style={{ margin: '0 0 14px' }}>Tap the one to hide. It goes back under its deck and nobody sees it.</p>
      <div className="wd-hand">
        {hand.map((c) => {
          const buriable = !!playMove(moves, hand.filter((x) => x.card !== c.card).map((x) => x.card));
          const off = hidden === c.card;
          return (
            <button key={c.card} type="button" className={`wd-pick${off ? ' off' : hidden ? ' on' : ''}`} aria-pressed={off} disabled={!buriable} onClick={() => setHidden(off ? null : c.card)}>
              <div className="wd-lab">{c.kind === 'number' ? 'Number clue' : 'Word clue'}</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{c.name}</div>
              <div className="wd-big" style={{ marginTop: 2 }}>{c.answer === null ? 'you answer' : String(c.answer)}</div>
              <div className="wd-lab" style={{ marginTop: 4, fontWeight: 500 }}>{off ? 'Hidden' : !buriable ? 'Must be played: the three need a number clue and a word clue' : hidden ? 'Played' : ''}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 14 }}>
        <button type="button" className="wd-btn go" disabled={!play} onClick={() => play && onMove(play)}>Play these three</button>
      </div>
    </div>
  );
}

/** Open hand: the engine lists one template; the debauchee picks any three cards. */
function OpenHand({ template, send, reference }: { template: LegalMove; send: Send; reference: unknown }) {
  const cards = isObj(reference) ? asArr(reference['clue_cards']).filter(isObj).map((c) => ({ id: asStr(c['id']), name: asStr(c['name']), kind: asStr(c['kind']), asks: asStr(c['asks']) })) : [];
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  return (
    <div>
      <h2 className="wd-h2">Play any three clues</h2>
      <p className="wd-help" style={{ margin: '0 0 14px' }}>{template.description}</p>
      {(['number', 'word'] as const).map((kind) => (
        <div key={kind} style={{ marginBottom: 12 }}>
          <div className="wd-lab" style={{ marginBottom: 6 }}>{kind === 'number' ? 'Number clues' : 'Word clues'}</div>
          <div className="wd-hand">
            {cards.filter((c) => c.kind === kind).map((c) => (
              <button key={c.id} type="button" className={`wd-pick${picked.includes(c.id) ? ' on' : ''}`} aria-pressed={picked.includes(c.id)} onClick={() => toggle(c.id)} title={c.asks}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
                <div className="wd-lab" style={{ fontWeight: 400 }}>{c.asks}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="wd-btn go" disabled={picked.length !== 3} onClick={() => send(template, { cards: picked }, ['cards'])}>Play these three</button>
    </div>
  );
}

function AnswerClues({ table, moves, send, onMove }: { table: WdTable; moves: LegalMove[]; send: Send; onMove: (m: LegalMove) => void }) {
  const r = table.round!;
  const [text, setText] = useState('');
  const open = r.clues.find((c) => c.answer === null);
  if (!open) return null;
  const card = find(moves, (m) => typeOf(m) === 'answer_clue' && m.move['card'] === open.card && m.move['text'] === undefined);
  const own = find(moves, (m) => typeOf(m) === 'answer_clue' && m.move['card'] === open.card && m.move['text'] !== undefined);
  const cardAnswer = table.secret?.hand.find((h) => h.card === open.card)?.answer;
  const word = table.secret?.word ?? 'your word';
  return (
    <div className="wd-answer">
      <h2 className="wd-h2">{open.name}: say it your way</h2>
      <p className="wd-help" style={{ margin: 0 }}>For {word}: {open.asks}.</p>
      {own && (
        <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (t) send(own, { text: t }, ['text']); }}>
          <label className="wd-sr" htmlFor="wd-own">Your answer</label>
          <input id="wd-own" className="wd-field" placeholder="Your answer" value={text} onChange={(e) => setText(e.target.value)} maxLength={60} autoComplete="off" />
          <button type="submit" className="wd-btn go" disabled={!text.trim()}>Say this</button>
        </form>
      )}
      {card && <button type="button" className="wd-btn" style={{ alignSelf: 'flex-start' }} onClick={() => onMove(card)}>Use the card's answer{cardAnswer !== undefined && cardAnswer !== null ? `: ${cardAnswer}` : ''}</button>}
    </div>
  );
}

function Reveal({ table, moves, onMove }: { table: WdTable; moves: LegalMove[]; onMove: (m: LegalMove) => void }) {
  const left = table.secret?.lettersLeft ?? [];
  const [letter, setLetter] = useState<string | null>(null);
  const reveals = moves.filter((m) => typeOf(m) === 'reveal');
  const rowMoves = letter ? reveals.filter((m) => m.move['letter'] === letter && m.move['row'] !== undefined) : [];
  return (
    <div className="wd-turn">
      <h2 className="wd-h2">Lay down one letter</h2>
      <p className="wd-help" style={{ margin: 0 }}>You choose which. Nobody learns where it goes.</p>
      <div className="wd-actions">
        {left.map((l) => {
          const plain = find(reveals, (m) => m.move['letter'] === l && m.move['row'] === undefined);
          const fromRows = reveals.some((m) => m.move['letter'] === l && m.move['row'] !== undefined);
          return (
            <button key={l} type="button" className={`wd-tile pick`} data-source={l} disabled={!plain && !fromRows} aria-label={`Lay down ${l}`}
              onClick={() => { if (plain) onMove(plain); else setLetter(l); }}>{l}</button>
          );
        })}
      </div>
      {letter && rowMoves.length > 0 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, margin: '6px 0' }}>No {letter} left in the pool. Take it from which row?</div>
          <div className="wd-actions">
            {rowMoves.map((m) => {
              const row = Number(m.move['row']);
              return <button key={m.move_id} type="button" className="wd-btn" onClick={() => onMove(m)}>From {table.round!.rows[row] ?? `row ${row + 1}`}</button>;
            })}
            <button type="button" className="wd-btn quiet" onClick={() => setLetter(null)}>Pick another letter</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- setup, results, the end ----------------------------------------------------------

function FirstDebauchee({ table, moves, me, onMove }: { table: WdTable; moves: LegalMove[]; me: string | null; onMove: (m: LegalMove) => void }) {
  const choices = moves.filter((m) => typeOf(m) === 'choose_first_debauchee');
  return (
    <div>
      <h2 className="wd-h2">Who goes first?</h2>
      <p className="wd-help" style={{ margin: '0 0 12px' }}>Whoever most recently got away with something is the first debauchee.</p>
      {choices.length === 0 && <p className="wd-help">Waiting for a player to say who.</p>}
      <div className="wd-actions">
        {choices.map((m) => <button key={m.move_id} type="button" className="wd-btn" onClick={() => onMove(m)}>{nameOf(table, asStr(m.move['player']), me)}</button>)}
      </div>
    </div>
  );
}

function Result({ result, table, me }: { result: RoundResult; table: WdTable; me: string | null }) {
  const deb = nameOf(table, result.debauchee, me);
  const down = `${result.revealed} letter${result.revealed === 1 ? '' : 's'} laid down${result.bribes ? `, ${result.bribes} clue${result.bribes === 1 ? '' : 's'} bribed` : ''}`;
  const order = [...table.seats].sort((a, b) => (a.id === result.debauchee ? 1 : 0) - (b.id === result.debauchee ? 1 : 0));
  return (
    <div className="wd-card" key={result.number} aria-label={`Round ${result.number} result`}>
      <div className="wd-lab">{result.outcome === 'cracked' && result.synonym ? `Cracked with ${result.synonym.toUpperCase()}. ${deb === 'You' ? 'Your' : `${deb}'s`} word was` : `Stumped. ${deb === 'You' ? 'Your' : `${deb}'s`} word was`}</div>
      <div className="wd-result-word">{result.word}</div>
      <div className="wd-help" style={{ marginBottom: 10 }}>{down}.</div>
      {order.map((s) => (
        <div key={s.id} className="wd-pay">
          <span>{nameOf(table, s.id, me)}{s.id === result.debauchee ? ', the debauchee' : ''}</span>
          <span className="wd-mono">+{result.payouts[s.id] ?? 0} = {s.score}</span>
        </div>
      ))}
    </div>
  );
}

function History({ table, me }: { table: WdTable; me: string | null }) {
  return (
    <div className="wd-card">
      <div className="wd-lab">{table.history.length} rounds played</div>
      <div className="wd-table-wrap">
        <table className="wd-table">
          <thead><tr><th>Word</th><th>Cracked with</th>{table.seats.map((s) => <th key={s.id}>{nameOf(table, s.id, me)}</th>)}</tr></thead>
          <tbody>
            {table.history.map((h) => (
              <tr key={h.number}>
                <td>{h.word}</td>
                <td>{h.outcome === 'cracked' && h.synonym ? h.synonym.toUpperCase() : 'stumped'}</td>
                {table.seats.map((s) => <td key={s.id} className="wd-mono">{s.id === h.debauchee ? `${h.payouts[s.id] ?? 0}*` : `+${h.payouts[s.id] ?? 0}`}</td>)}
              </tr>
            ))}
            <tr><td style={{ fontWeight: 600 }}>Total</td><td />{table.seats.map((s) => <td key={s.id} className="wd-mono" style={{ fontWeight: table.winners?.includes(s.id) ? 600 : 400 }}>{s.score}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <div className="wd-lab" style={{ marginTop: 8, fontWeight: 400 }}>* the round that seat was the debauchee</div>
    </div>
  );
}

function HowToPlay({ table, me, reference }: { table: WdTable; me: string | null; reference: unknown }) {
  const r = table.round;
  const deb = r ? nameOf(table, r.debauchee, me) : 'The debauchee';
  const scoring = isObj(reference) && isObj(reference['scoring']) ? reference['scoring'] : null;
  return (
    <div className="wd-clue" style={{ fontSize: 14, lineHeight: 1.5, animation: 'none' }}>
      <p style={{ margin: 0 }}>
        {deb === 'You' ? 'You know' : `${deb} knows`} a secret word. Everyone else spells any word that means the same.
        On your turn do one thing: place a tile, move a tile, or call Reveal! for another letter.
        A word is checked with the tile that finishes it: press Place and Check!
      </p>
      {scoring && (
        <p style={{ margin: '8px 0 0' }}>
          Cracked: {asStr(scoring['cracked'])}. Stumped: {asStr(scoring['stumped'])}.
        </p>
      )}
    </div>
  );
}
