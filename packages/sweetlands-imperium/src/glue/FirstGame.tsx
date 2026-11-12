// The "How to play" page (build item 8, First-Game.dc.html): how to score,
// the three pieces and the four treat shapes, moving by color, the four
// steps of a turn and the six color actions. Opened from the turn column's
// "How to play" button, and shown by itself before a person's first
// Sweetlands game on this browser (remembered in localStorage; a private
// window simply shows it again). The goals, their points, points to win and
// the sugar die's faces are the engine's reference data.

import { Sheet } from '@zekel/glue-kit';
import { asArr, asNum, asStr, isObj } from '@zekel/glue-kit';
import type { GlueInput } from '@zekel/glue-kit';
import { PieceArt, TreatChip, type FactionKey, type UnitKey } from './art.js';
import { COLOR_ACTION, COLORS, cap } from './colors.js';

const SEEN_KEY = 'zk:sl-how-to-play-seen';

export function howToPlaySeen(): boolean {
  try { return window.localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}
export function markHowToPlaySeen(): void {
  try { window.localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage blocked: it shows again next time */ }
}

const SHAPES: Array<{ f: FactionKey; name: string; shape: string }> = [
  { f: 'milkshake', name: 'Milkshake', shape: 'glass' },
  { f: 'fudge', name: 'Fudge', shape: 'cube' },
  { f: 'jellybean', name: 'Jellybean', shape: 'bean' },
  { f: 'cheesecake', name: 'Cheesecake', shape: 'slice' },
];
const PIECES: Array<{ u: UnitKey; name: string; text: string }> = [
  { u: 'leader', name: 'Leader · candy crown', text: 'Gathers influence. Claims the castle once its foe is gone.' },
  { u: 'knight', name: 'Knight · sword', text: 'Fights rival Knights and the castle foe. Captures pieces.' },
  { u: 'ambassador', name: 'Ambassador · wrapped candy', text: 'Draws Intel cards. Travel far from home to draw more.' },
];

interface Goal { text: string; points: number }

function goals(input: GlueInput): { toWin: number | null; list: Goal[]; faces: number[] } {
  const rd = input.reference?.referenceData;
  if (!isObj(rd)) return { toWin: null, list: [], faces: [] };
  const list: Goal[] = asArr(rd['public_objectives']).filter(isObj).map((o) => ({ text: asStr(o['description']), points: asNum(o['points']) }));
  const secret = asArr(rd['secret_objectives']).filter(isObj)[0];
  if (secret) list.push({ text: 'Your secret goal (only you can see it).', points: asNum(secret['points']) });
  list.sort((a, b) => b.points - a.points);
  return {
    toWin: typeof rd['points_to_win'] === 'number' ? rd['points_to_win'] : null,
    list,
    faces: asArr(rd['sugar_die_faces']).filter((n): n is number => typeof n === 'number'),
  };
}

function Num({ n }: { n: number }) {
  return <span className="sl-howto-n">{n}</span>;
}

export function FirstGame({ input, onClose }: { input: GlueInput; onClose(): void }) {
  const g = goals(input);
  const faces = g.faces.length ? g.faces.join(', ').replace(/, (\d+)$/, ' or $1') : null;
  return (
    <Sheet title="How to play Sweetlands Imperium" onClose={onClose} className="sl-howto" heading={(
      <div className="sl-howto-head">
        <img src="/art/sweetlands/sweet-milkshake.jpg" alt="" />
        <div>
          <div className="sl-howto-kicker">New to Sweetlands Imperium?</div>
          <h2>The whole game on one page</h2>
          <p>The Sugar King is dead. Four dessert rulers race for his throne. Read this once; the table reminds you of the rest as you play.</p>
        </div>
        <button type="button" className="sl-main-btn" onClick={onClose}>Got it, let’s play</button>
      </div>
    )}>
      <div className="sl-howto-grid top">
        <section className="sl-panel">
          <h3><Num n={1} />{g.toWin ? `Be first to ${g.toWin} points` : 'Score points to win'}</h3>
          <p className="sl-hint">Each goal scores once per player.</p>
          <ul className="sl-howto-goals">
            {g.list.map((x) => <li key={x.text}><span>{x.text}</span><b>{x.points}</b></li>)}
          </ul>
        </section>
        <section className="sl-panel">
          <h3><Num n={2} />You have three pieces</h3>
          <p className="sl-hint">Every faction’s pieces are shaped like its leader’s treat.</p>
          <div className="sl-howto-shapes">
            {SHAPES.map((s) => <span key={s.f}><TreatChip faction={s.f} size={30} /><b>{s.name}</b><span>{s.shape}</span></span>)}
          </div>
          <p className="sl-hint">The picture on a piece tells you which one it is:</p>
          <ul className="sl-howto-pieces">
            {PIECES.map((p) => <li key={p.u}><PieceArt faction="fudge" unit={p.u} size={26} /><span><b>{p.name}</b><span>{p.text}</span></span></li>)}
          </ul>
        </section>
        <section className="sl-panel">
          <h3><Num n={3} />Cards move you by color</h3>
          <p>Play a red card: one piece jumps forward to the <b>next red space</b>, however far that is. No counting.</p>
          <div className="sl-howto-strip" aria-label="A piece on green jumps past blue and purple to the next red space">
            {['green', 'blue', 'purple', 'red', 'orange', 'yellow'].map((c, i) => (
              <span key={c} className={`sl-c-${c}${c === 'red' ? ' target' : ''}`}>{i === 0 && <PieceArt faction="milkshake" unit="knight" size={20} />}</span>
            ))}
          </div>
          <p>Pieces always travel <b>counter-clockwise</b> round the four lands. At each land’s first purple space (the <b>crossroads</b>) you may turn onto the road that leads to the Candy Castle.</p>
        </section>
      </div>
      <div className="sl-howto-grid bottom">
        <section className="sl-panel">
          <h3><Num n={4} />Your turn, in four steps</h3>
          <ol className="sl-howto-steps">
            <li><b>Recall</b> (optional). Send any of your pieces back home.</li>
            <li><b>Draw.</b> Press Draw to take Intel cards: more when your Ambassador is far from home.</li>
            <li><b>Play one card</b> to move a piece and take its color’s action. Or pass for +1 influence.</li>
            <li><b>Spend influence</b> (optional) on Intel tokens and sugar cubes. Then End turn.</li>
          </ol>
          <p className="sl-tip"><b>Sugar cubes are your battle dice.</b>{faces ? ` Each one rolls ${faces}.` : ''} Battles only happen when you press the button that starts them.</p>
        </section>
        <section className="sl-panel">
          <h3><Num n={5} />Every color is an action</h3>
          <p className="sl-hint">After moving, you may take the card’s action. Each action helps one piece most.</p>
          <div className="sl-howto-colors">
            {COLORS.map((c) => (
              <div key={c}>
                <span className={`sl-howto-cap sl-c-${c}`} />
                <b>{COLOR_ACTION[c].name}</b> <span className="sl-hint">· {cap(COLOR_ACTION[c].who)}</span>
                <p>{COLOR_ACTION[c].text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <p className="sl-hint sl-howto-foot">You can open this page again any time from <b>How to play</b> at the top of the turn column.</p>
    </Sheet>
  );
}
