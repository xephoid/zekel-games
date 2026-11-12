// The turn panel (build item 6): the four-step tracker, then "what to do now".
// Every button sends a move the engine listed, and only when the person
// presses it; nothing is chosen for them. Options for a picked card come from
// the engine's moves for that card, the destination from each move's landing,
// the sentence from its description. Dice appear only after Roll, from the
// engine's record of the battle.

import type { ReactNode } from 'react';
import { MoveFormSheet } from '@zekel/glue-kit';
import { asArr, asStr, isObj, words } from '@zekel/glue-kit';
import type { GlueInput, LegalMove, MoveForm } from '@zekel/glue-kit';
import { SugarCube } from './art.js';
import { COLOR_ACTION, cap, isColor } from './colors.js';
import { cardLabel } from './Hand.js';
import { UNIT_NAME, type SlTable } from './read.js';
import type { PlayOption, TurnStep } from './turn.js';

const STEPS = ['Recall', 'Draw', 'Play a card', 'Influence'];
const STEP_INDEX: Partial<Record<TurnStep, number>> = { recall: 0, draw: 1, play: 2, influence: 3 };

export function StepTracker({ step }: { step: TurnStep }) {
  const at = STEP_INDEX[step];
  return (
    <div className="sl-panel sl-steps" aria-label="Your turn has four steps">
      <div className="sl-hint">Your turn has four steps</div>
      <ol>
        {STEPS.map((s, i) => {
          const state = at === undefined ? '' : i < at ? 'done' : i === at ? 'now' : '';
          return (
            <li key={s} className={state} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="sl-step-n">{state === 'done' ? 'done' : `step ${i + 1}`}</span>
              {s}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What a color's action button says. */
function actionLabel(color: string): string {
  switch (color) {
    case 'red': return 'Move and battle';
    case 'orange': return 'Move and gain influence';
    case 'yellow': return 'Move and collect taxes';
    case 'blue': return 'Move and draw Intel';
    case 'purple': return 'Move and enter the castle';
    default: return 'Move and take the action';
  }
}

export interface BattleView {
  id: number;
  kind: string;
  attacker: { pid: string; faces: number[] | null; total: number };
  defender: { pid: string | null; foe: string | null; faces: number[]; total: number };
  winner: string;
  automatic: boolean;
}

export function readBattle(view: unknown): BattleView | null {
  if (!isObj(view) || !isObj(view['last_battle'])) return null;
  const b = view['last_battle'];
  const side = (x: unknown) => (isObj(x) ? x : {});
  const a = side(b['attacker']);
  const d = side(b['defender']);
  const faces = (x: unknown) => (Array.isArray(x) ? x.filter((n): n is number => typeof n === 'number') : null);
  return {
    id: typeof b['id'] === 'number' ? b['id'] : 0,
    kind: asStr(b['kind']),
    attacker: { pid: asStr(a['player_id']), faces: faces(a['faces']), total: typeof a['total'] === 'number' ? a['total'] : 0 },
    defender: { pid: typeof d['player_id'] === 'string' ? d['player_id'] : null, foe: typeof d['foe'] === 'string' ? d['foe'] : null, faces: faces(d['faces']) ?? [], total: typeof d['total'] === 'number' ? d['total'] : 0 },
    winner: asStr(b['winner']),
    automatic: b['automatic'] === true,
  };
}

function Dice({ faces, blank, rollKey }: { faces: Array<number | null>; blank?: boolean; rollKey?: number }) {
  return (
    <span className="sl-dice">
      {faces.map((f, i) => (
        <span key={`${rollKey ?? 0}:${i}`} className={`sl-die${blank ? ' blank' : ' rolled'}`} style={{ animationDelay: `${i * 60}ms` }}>
          {blank || f === null ? '' : f}
        </span>
      ))}
    </span>
  );
}

interface PanelProps {
  table: SlTable;
  input: GlueInput;
  step: TurnStep;
  pressable: boolean;
  busy: boolean;
  nameFor(pid: string): string;
  onMove(m: LegalMove): void;
  onDraw?: () => void;
  formFor(m: LegalMove): MoveForm | null;
  onForm(template: LegalMove, move: Record<string, unknown>, keys: string[]): void;
  /** the picked card or Intel token ("token:blue"), and its numbered options */
  picked: string | null;
  setPicked(id: string | null): void;
  options: PlayOption[];
  /** moves for the picked card that move nothing (Green's discard) */
  extra: LegalMove[];
  chosen: number | null;
  setChosen(n: number | null): void;
  /** a foe battle is ready to roll: the move the Roll button sends */
  arming: LegalMove | null;
  setArming(m: LegalMove | null): void;
  /** a battle the engine just resolved, shown until Continue */
  battle: BattleView | null;
  onBattleSeen(): void;
  template: LegalMove | null;
  setTemplate(m: LegalMove | null): void;
}

function Option({ o, onPick, disabled }: { o: PlayOption; onPick(): void; disabled: boolean }) {
  return (
    <button type="button" className="sl-option" onClick={onPick} disabled={disabled}>
      <span className="sl-option-n">{o.n}</span>
      <span className="sl-option-words"><b>{o.title}</b><span>{o.sentence}</span></span>
    </button>
  );
}

function Choice({ m, label, onMove, disabled, main }: { m: LegalMove; label?: ReactNode; onMove(m: LegalMove): void; disabled: boolean; main?: boolean }) {
  return (
    <button type="button" className={main ? 'sl-main-btn' : 'sl-quiet-choice'} onClick={() => onMove(m)} disabled={disabled}>
      {label ?? m.description}
    </button>
  );
}

/** "Capture Bo’s Leader (scores your secret goal, +2)", from the move's own fields. */
function captureTitle(m: LegalMove, nameFor: (pid: string) => string): string {
  const unit = asStr(m.move['targetUnit']);
  const who = `Capture ${nameFor(asStr(m.move['targetPlayerId']))}’s ${UNIT_NAME[unit as keyof typeof UNIT_NAME] ?? unit}`;
  const scores = m.move['captureLeaderScores'];
  const goal = scores === 'secret' ? ' (scores your secret goal, +2)' : scores === 'public' ? ' (scores the public goal, +1)' : '';
  return `${who}${goal}`;
}

/** A capture button: a short title from the move's fields, then the engine's
 *  own full description, so nothing it says (an enemy Knight to beat first,
 *  what a double card's second half does) is lost or reworded. */
function captureLabel(m: LegalMove, nameFor: (pid: string) => string): ReactNode {
  return <span className="sl-option-words"><b>{captureTitle(m, nameFor)}</b><span>{m.description}</span></span>;
}

function pickedColor(table: SlTable, picked: string | null): string {
  if (!picked) return '';
  if (picked.startsWith('token:')) return picked.slice(6);
  return table.hand?.find((c) => c.cardId === picked)?.color ?? '';
}

function pickedTitle(table: SlTable, picked: string): string {
  if (picked.startsWith('token:')) return `${cap(picked.slice(6))} Intel token`;
  const c = table.hand?.find((x) => x.cardId === picked);
  return c ? cardLabel(c).replace(':', ' ·') : 'Your card';
}

function objectiveText(input: GlueInput, id: string): string {
  const rd = input.reference?.referenceData;
  const def = isObj(rd) ? asArr(rd['secret_objectives']).find((o) => isObj(o) && o['id'] === id) : undefined;
  return isObj(def) ? asStr(def['description']) : words(id);
}

export function TurnPanel(p: PanelProps) {
  const { table, input, step, pressable, busy, onMove, picked, options, chosen } = p;
  const legal = input.legalMoves;
  const disabled = !pressable;
  const send = (m: LegalMove) => { p.setChosen(null); p.setPicked(null); p.setArming(null); onMove(m); };
  let body: ReactNode;

  if (p.battle) {
    const b = p.battle;
    const mine = b.attacker.pid === table.me?.pid;
    const theirName = b.defender.foe ? `The ${words(b.defender.foe)}` : b.defender.pid ? `${p.nameFor(b.defender.pid)}’s Knight` : 'The defender';
    const yourName = mine ? 'Your Knight' : `${p.nameFor(b.attacker.pid)}’s Knight`;
    const won = b.winner === 'attacker';
    body = (
      <>
        <h2 className="sl-panel-title">Battle!</h2>
        {b.automatic ? (
          <p className="sl-panel-text">Jellybean’s Knight wins a knight battle without rolling.</p>
        ) : (
          <div className="sl-battle">
            <div className="sl-battle-side mine"><b>{yourName}</b><Dice faces={b.attacker.faces ?? []} rollKey={b.id} /><span>Total {b.attacker.total}</span></div>
            <span className="sl-vs">vs</span>
            <div className="sl-battle-side"><b>{theirName}</b><Dice faces={b.defender.faces} rollKey={b.id} /><span>Total {b.defender.total}</span></div>
          </div>
        )}
        <p className="sl-panel-text">{won ? `${yourName} wins.` : `${theirName} holds. Ties go to the defender.`}</p>
        <button type="button" className="sl-main-btn" onClick={p.onBattleSeen}>Continue</button>
      </>
    );
  } else if (step === 'waiting' || step === 'over') {
    const active = table.players.find((x) => x.active);
    body = (
      <>
        <h2 className="sl-panel-title">{step === 'over' ? 'The game is over' : active ? `${active.isMe ? 'Your' : `${p.nameFor(active.pid)}’s`} turn` : 'Waiting'}</h2>
        <p className="sl-panel-text">{step === 'over' ? 'The last move is in the log.' : 'Their moves appear on the board and in the log as they make them.'}</p>
      </>
    );
  } else if (step === 'draw') {
    const m = legal.find((x) => x.move['type'] === 'resolve_report');
    body = (
      <>
        <h2 className="sl-panel-title">Draw your Intel</h2>
        <p className="sl-panel-text">{m?.description}</p>
        {p.onDraw && <button type="button" className="sl-main-btn" onClick={p.onDraw} disabled={busy}>Draw</button>}
      </>
    );
  } else if (step === 'secret') {
    body = (
      <>
        <h2 className="sl-panel-title">Keep one secret goal</h2>
        <p className="sl-panel-text">It scores 2 points when you do it. Only you can see it; the other passes on.</p>
        {legal.filter((m) => m.move['type'] === 'choose_secret_objective').map((m) => (
          <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} label={<><b>{objectiveText(input, asStr(m.move['objective']))}</b></>} />
        ))}
      </>
    );
  } else if (step === 'capture') {
    body = (
      <>
        <h2 className="sl-panel-title">Second capture</h2>
        <p className="sl-panel-text">Your double Battle card moved your Knight again. Who does it capture this time?</p>
        {legal.filter((m) => m.move['type'] === 'choose_capture').map((m) => (
          <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} label={captureLabel(m, p.nameFor)} />
        ))}
      </>
    );
  } else if (step === 'recall') {
    body = (
      <>
        <h2 className="sl-panel-title">Recall</h2>
        <p className="sl-panel-text">You may bring any of your pieces back home before you draw. Most turns you skip this.</p>
        {legal.filter((m) => m.move['type'] === 'recall').map((m) => <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} />)}
      </>
    );
  } else if (step === 'influence') {
    const buys = legal.filter((m) => m.move['type'] === 'buy_intel_token' || m.move['type'] === 'buy_sugar_cube');
    const sinks = legal.filter((m) => m.move['type'] === 'discard_sugar' || m.move['type'] === 'trash_influence');
    const end = legal.find((m) => m.move['type'] === 'end_turn');
    body = (
      <>
        <h2 className="sl-panel-title">Spend influence</h2>
        <p className="sl-panel-text">You have <b>{table.me?.influence ?? 0} influence</b>. Spending is optional.</p>
        {buys.map((m) => <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} />)}
        {sinks.length > 0 && (
          <details className="sl-more">
            <summary>Throw away sugar or influence (for a secret goal)</summary>
            {sinks.map((m) => <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} />)}
          </details>
        )}
        {end && <Choice m={end} onMove={send} disabled={disabled} main label="End turn" />}
      </>
    );
  } else if (step === 'play' && p.arming) {
    const me = table.me;
    const foeDice = table.foe?.dice ?? 0;
    body = (
      <>
        <h2 className="sl-panel-title">Battle!</h2>
        <div className="sl-battle">
          <div className="sl-battle-side mine"><b>Your Knight</b><Dice faces={Array.from({ length: me?.sugar ?? 0 }, () => null)} blank /><span>{me?.sugar ?? 0} sugar cubes</span></div>
          <span className="sl-vs">vs</span>
          <div className="sl-battle-side"><b>The {words(table.foe?.type ?? 'foe')}</b><Dice faces={Array.from({ length: foeDice }, () => null)} blank /><span>{foeDice} sugar cubes</span></div>
        </div>
        <p className="sl-panel-text">{p.arming.description}</p>
        <button type="button" className="sl-roll-btn" onClick={() => send(p.arming!)} disabled={disabled}>Roll</button>
        <button type="button" className="sl-back" onClick={() => p.setArming(null)}>← Back</button>
      </>
    );
  } else if (step === 'play' && picked && chosen !== null && options[chosen - 1]) {
    const o = options[chosen - 1]!;
    const color = pickedColor(table, picked);
    const rolls = (m: LegalMove | null) => !!m && /rolls your sugar cubes/i.test(m.description ?? '');
    body = (
      <>
        <div className="sl-hint">{pickedTitle(table, picked)}</div>
        <h2 className="sl-panel-title">{o.title}</h2>
        <p className="sl-panel-text">{o.sentence}</p>
        <div className="sl-choice-row">
          {o.captures.length > 1
            ? o.captures.map((m) => <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} label={captureLabel(m, p.nameFor)} />)
            : o.act && (
              <button type="button" className="sl-main-btn" disabled={disabled} onClick={() => (rolls(o.act) ? p.setArming(o.act) : send(o.act!))}>
                {isColor(color) ? actionLabel(color) : 'Move and take the action'}
              </button>
            )}
          {o.raise && <Choice m={o.raise} onMove={send} disabled={disabled} label="Collect taxes and raise the tax" />}
          {o.move && <Choice m={o.move} onMove={send} disabled={disabled} main={!o.act} label={o.act ? 'Just move' : 'Move there'} />}
          {o.template && (
            <button type="button" className="sl-main-btn" disabled={disabled} onClick={() => p.setTemplate(o.template)}>Choose the treat</button>
          )}
        </div>
        <button type="button" className="sl-back" onClick={() => p.setChosen(null)}>← Pick a different piece</button>
      </>
    );
  } else if (step === 'play' && picked) {
    const color = pickedColor(table, picked);
    body = (
      <>
        <h2 className="sl-panel-title">
          {color && <span className={`sl-swatch big sl-c-${color}`} />}
          {pickedTitle(table, picked)}
        </h2>
        <p className="sl-panel-text">Which piece moves? The numbers match the dashed outlines on the board.</p>
        <div className="sl-options">
          {options.map((o) => <Option key={o.n} o={o} onPick={() => p.setChosen(o.n)} disabled={disabled} />)}
          {p.extra.map((m) => <Choice key={m.move_id} m={m} onMove={send} disabled={disabled} />)}
        </div>
        {options.length === 0 && p.extra.length === 0 && <p className="sl-panel-text">The engine lists no move for this card right now.</p>}
        <button type="button" className="sl-back" onClick={() => p.setPicked(null)}>Put the card back</button>
      </>
    );
  } else if (step === 'play') {
    const pass = legal.find((m) => m.move['type'] === 'pass');
    const tokens = [...new Set(legal.filter((m) => m.move['type'] === 'play_token').map((m) => asStr(m.move['color'])))];
    body = (
      <>
        <h2 className="sl-panel-title">Play one card</h2>
        <p className="sl-panel-text">Pick a card from your hand. A card moves <b>one</b> of your pieces forward to the <b>next space of its color</b>, then lets you take that color’s action.</p>
        <p className="sl-tip">Tip: you can move any piece with any card, but each action only helps one kind of piece. The Battle card is best with your Knight.</p>
        {tokens.map((c) => (
          <button key={c} type="button" className="sl-quiet-choice" disabled={disabled} onClick={() => p.setPicked(`token:${c}`)}>
            <span className={`sl-swatch sl-c-${c}`} /> Spend your {c} Intel token instead{isColor(c) ? ` (${COLOR_ACTION[c].name})` : ''}
          </button>
        ))}
        {pass && <Choice m={pass} onMove={send} disabled={disabled} label="Pass instead (+1 influence, ends turn)" />}
      </>
    );
  } else {
    body = (
      <>
        <h2 className="sl-panel-title">Your move</h2>
        <p className="sl-panel-text">Pick from the numbered moves below the board.</p>
      </>
    );
  }

  const tform = p.template ? p.formFor(p.template) : null;
  return (
    <>
      <section className="sl-panel sl-now" aria-label="What to do now">{body}</section>
      {p.template && tform && (
        <MoveFormSheet
          form={tform} disabled={disabled}
          onSend={(move) => { p.onForm(p.template!, move, tform.editableKeys); p.setTemplate(null); p.setChosen(null); p.setPicked(null); }}
          onClose={() => p.setTemplate(null)}
        />
      )}
    </>
  );
}
