// The overlays any part can be under (build item 5): level up (Setup.dc.html,
// "Level up"), releasing crew when the ship is over capacity, and the
// departure peek (Habitat.dc.html, "Departure peek"). Each sends a listed
// move; the peek completes the engine's report_res_discard template with the
// card the captain chose from the ones the engine revealed.

import type { LegalMove } from '@zekel/glue-kit';
import { asNum, asStr } from '@zekel/glue-kit';
import { abilityWords, previewOf } from '../facts.js';
import { statGroups, type WwTable } from '../read.js';
import { TravelCard } from '../TravelCard.js';
import { travelCard } from '../cards.js';
import { GoldButton, Lbl, Num, Token } from '../ui.js';
import type { PartProps } from './SpacePart.js';

export function LevelUp({ table, input, pressable, onMove }: PartProps) {
  const me = table.me;
  if (!me) return null;
  const groups = statGroups(input.reference);
  const by = Object.fromEntries(me.abilities.map((a) => [a.code, a]));
  const moves = input.legalMoves.filter((m) => m.move['type'] === 'level_up');
  const next = me.level + 1;
  return (
    <div className="ww-ov" role="presentation">
      <div className="ww-modal" role="dialog" aria-label="Level up" style={{ width: 'min(960px, 100%)' }}>
        <div className="ww-row" style={{ gap: 22 }}>
          <div className="ww-lv-circle"><Lbl>LEVEL</Lbl><Num>{next}</Num></div>
          <div className="ww-col" style={{ gap: 6 }}>
            <Lbl style={{ color: '#FFD700' }}>{me.xp} XP REACHED</Lbl>
            <h1 className="ww-h1" style={{ fontSize: 36 }}>{next % 2 === 0 ? 'Add +1 to one ability, or open a new one' : 'Add +1 to one ability'}</h1>
            <span className="ww-lede">Each choice below says what the ability does. A natural 3 in one gives its advanced skill; a score raised by an item does not count.</span>
          </div>
        </div>
        <div className="ww-lv-grid">
          {groups.map((g) => (
            <div key={g.stat} className="ww-lv-col">
              <Lbl style={{ fontSize: 11, color: '#aab1d3' }}>{g.stat.toUpperCase()}</Lbl>
              {g.abilities.map((a) => {
                const v = by[a.code]?.natural ?? 0;
                const m = moves.find((x) => asStr(x.move['ability']) === a.code);
                const opens = (m?.move_id ?? '').startsWith('level-up-open');
                const w = abilityWords(input.reference, a.code);
                const then = previewOf(m)?.then;
                return (
                  <button key={a.code} type="button" className="ww-lv-cell" disabled={!pressable || !m} onClick={() => m && onMove(m)} aria-label={`${a.name}${m ? (opens ? ', open at 1' : `, ${v} to ${v + 1}`) : ', not available'}`}>
                    <span className="ww-lv-head"><span>{a.code}</span><Num style={{ fontSize: 15 }}>{m ? (opens ? '0 → 1' : `${v} → ${v + 1}`) : String(v)}</Num></span>
                    <span className="ww-lv-note"><b>{a.name}.</b> {w?.basic ?? then ?? ''}</span>
                    {m && !opens && v + 1 === 3 && w?.advanced && <span className="ww-lv-note adv">Gives {w.advanced.name}: {w.advanced.what}</span>}
                    {!m && <span className="ww-lv-note">{v === 0 ? 'A new ability can be opened only on reaching an even level.' : ''}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReleaseCrew({ table, input, pressable, onMove }: PartProps) {
  const moves = input.legalMoves.filter((m) => m.move['type'] === 'release_crew');
  return (
    <div className="ww-ov" role="presentation">
      <div className="ww-modal" role="dialog" aria-label="Release crew">
        <div className="ww-col" style={{ gap: 4 }}>
          <Lbl style={{ color: '#FFD700' }}>OVER CAPACITY</Lbl>
          <span className="ww-h1" style={{ fontSize: 30 }}>Someone has to go</span>
          <span className="ww-lede">The ship holds {table.ship?.capacity ?? '?'} and {1 + table.crew.length} are aboard. Whoever leaves takes their equipped gear.</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {table.crew.map((c) => {
            const m = moves.find((r) => asStr(r.move['crew_name']) === c.name);
            return (
              <div key={c.name} className="ww-release">
                <Token race={c.race} size={52} />
                <span className="ww-col" style={{ flex: 1 }}><span className="ww-h2" style={{ fontSize: 18 }}>{c.name}</span><span className="ww-dim" style={{ fontSize: 12 }}>{c.race} · anger {c.anger}</span></span>
                <button type="button" className="ww-release-btn" disabled={!pressable || !m} onClick={() => m && onMove(m)}>RELEASE</button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The Research or Diplomacy peek before departing: the revealed cards, discard one or leave them. */
export function DeparturePeek({ table, input, pressable, onMove, onForm }: PartProps) {
  const p = table.pending;
  const n = asNum(p?.['peek_count'], table.peek.length);
  const template = input.legalMoves.find((m) => m.move['type'] === 'report_res_discard');
  const skip = input.legalMoves.find((m) => m.move['type'] === 'skip_res_peek');
  const faces = table.peek.map((id) => ({ id, face: travelCard(id, input.reference) }));
  return (
    <div className="ww-ov" role="presentation">
      <div className="ww-modal" role="dialog" aria-label="Peek at the deck">
        <div className="ww-col" style={{ gap: 4 }}>
          <Lbl style={{ color: '#FFD700' }}>BEFORE YOU LEAVE · RESEARCH OR DIPLOMACY PEEK</Lbl>
          <span className="ww-h1" style={{ fontSize: 30 }}>Peek at the top {n === 1 ? 'card' : `${n} cards`}</span>
          <span className="ww-lede">{faces.length > 0 ? 'These are the top of your travel deck, in order. Discard one of them, or leave them as they are.' : 'The engine has not revealed the cards to this seat; name the one you discard in the menu, or leave them.'}</span>
        </div>
        <div className="ww-row" style={{ gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {faces.map(({ id, face }) => (
            <div key={id} className="ww-col" style={{ gap: 10, alignItems: 'center' }}>
              {face ? <TravelCard face={face} /> : <span className="ww-num">{id}</span>}
              <GoldButton onClick={() => template && onForm(template, { ...template.move, card: id }, ['card'])} disabled={!pressable || !template}>DISCARD IT</GoldButton>
            </div>
          ))}
          <div className="ww-col" style={{ gap: 10, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 14, lineHeight: 1.5, color: '#c9cfee' }}>A discarded card goes face up on the discard; the rest stay in order. The peek happens once, as you depart.</span>
            <GoldButton quiet onClick={() => skip && onMove(skip)} disabled={!pressable || !skip}>LEAVE {n === 1 ? 'IT' : 'THEM'} ON TOP</GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export type { LegalMove, WwTable };
