// The pirate fight (Pirate.dc.html, build item 5): the pirate's card with
// its stamps, the step tracker, and the ways to go at each step. Each way
// shows what the engine says it leads to: the roll, its chance, what winning
// and losing do. A way the engine does not list is drawn shut with the
// engine's reason. The captain's sheet stays on the left throughout.

import { asStr } from '@zekel/glue-kit';
import { artFor } from '../cards.js';
import { previewOf, reasonFor } from '../facts.js';
import { Icon, type IconName } from '../icons.js';
import { moveById, type WwTable } from '../read.js';
import { Lbl, Num, GoldButton } from '../ui.js';
import { Hologram } from '../holo.js';
import { faceUrl } from '../faces.js';
import { Choice } from './Choice.js';
import { RollPanel } from './RollPanel.js';
import type { PartProps } from './SpacePart.js';

const STEPS = ['Approach', 'Exchange', 'Board or leave', 'Capture'];

function stepIndex(table: WwTable): number {
  const p = table.pending;
  const stage = table.combat?.stage ?? '';
  if (p?.kind === 'evade_offer' || (p?.kind === 'roll' && asStr(p['reason']) === 'evade')) return 0;
  if (stage === 'captured') return 3;
  if (stage === 'disabled') return 2;
  return 1;
}

export function PirateSteps({ table }: { table: WwTable }) {
  const at = stepIndex(table);
  return (
    <nav className="ww-steps" aria-label="Fight steps">
      {STEPS.map((n, i) => (
        <span key={n} className="ww-row" style={{ gap: 10 }}>
          {i > 0 && <span className={`ww-step-line${i <= at ? ' on' : ''}`} />}
          <span className={`ww-step${i === at ? ' cur' : i < at ? ' done' : ''}`}><span className="ww-step-dot">{i < at ? '✓' : i + 1}</span>{n}</span>
        </span>
      ))}
    </nav>
  );
}

/** The pirate's card: the ship icon, the captain's red token, the numbers, the stamps. */
export function PirateCard({ table }: { table: WwTable }) {
  const face = table.combat?.face ?? table.card;
  if (!face || face.kind !== 'pirate') return null;
  const c = table.combat ?? { card: `♦${face.rank}`, rank: face.rank, stage: '', rerollUsed: false, volleyUsed: false, redlineUsed: false, survivorsUsed: false, pirateDebuff: 0, playerBuff: 0, face };
  const out = c.stage === 'disabled' || c.stage === 'captured';
  const buffs: string[] = [];
  if (c.pirateDebuff) buffs.push(`opening volley landed · −${c.pirateDebuff} to them`);
  else if (c.volleyUsed) buffs.push('opening volley · tried');
  if (c.playerBuff) buffs.push(`redline · +${c.playerBuff} to you`);
  else if (c.redlineUsed) buffs.push('redline · tried');
  if (c.rerollUsed) buffs.push('Flying Ace reroll · used');
  if (c.stage === 'disabled') buffs.push('disabled');
  if (c.stage === 'captured') buffs.push('captured');
  const captain = faceUrl('pirate-captain');
  return (
    <div className="ww-pirate-card" aria-label={`Pirates ${c.card}`}>
      <div className="ww-pirate-band"><span className="ww-row" style={{ gap: 6 }}><Icon name="skull" size={16} /><Lbl>PIRATES</Lbl></span><Num style={{ fontSize: 14 }}>{c.card.replace('♦', '♦ ')}</Num></div>
      <div className={`ww-pirate-pic${out ? ' out' : ''}`}>
        <Icon name={artFor(face)} size={120} />
        {captain && <span className="ww-pirate-face"><Hologram src={captain} kind="red" size={64} style={{ border: '3px solid #f07070', borderRadius: '50%' }} /></span>}
        {out && <span className={`ww-stamp ${c.stage === 'captured' ? 'gold' : 'green'}`} style={{ position: 'absolute', left: 16, top: 14 }}>{c.stage.toUpperCase()}</span>}
      </div>
      <div className="ww-pirate-body">
        <div className="ww-col"><span className="ww-h2" style={{ fontSize: 24 }}>{face.title}</span><span className="ww-dim" style={{ fontSize: 13 }}>{face.line}</span></div>
        <div className="ww-pirate-attack"><Num>+{face.spaceAttack}</Num><Lbl style={{ fontSize: 11, color: '#aab1d3' }}>SPACE ATTACK</Lbl></div>
        <div className="ww-pirate-stats">{(face.stats ?? []).map((s) => <span key={s.k}><Num>{s.v}</Num><span>{s.k}</span></span>)}</div>
        {buffs.length > 0 && <div className="ww-chips">{buffs.map((b) => <span key={b} className="ww-buff">{b}</span>)}</div>}
      </div>
    </div>
  );
}

const EXCHANGE: Array<{ id: string; type: string; name: string; icon: IconName }> = [
  { id: 'fight-round', type: 'fight_round', name: 'Exchange fire', icon: 'starfighter' },
  { id: 'attempt-escape', type: 'attempt_escape', name: 'Escape', icon: 'rocket' },
  { id: 'attempt-hack', type: 'attempt_hack', name: 'Hack', icon: 'satcom' },
  { id: 'open-fire', type: 'open_fire', name: 'Opening volley', icon: 'gun' },
  { id: 'redline', type: 'redline', name: 'Redline', icon: 'bolt' },
  { id: 'attempt-intimidate', type: 'attempt_intimidate', name: 'Stand down or burn', icon: 'pirate' },
];

export function PiratePart(props: PartProps) {
  const { table, input, pressable, onMove } = props;
  const p = table.pending;
  const c = table.combat;
  const face = c?.face ?? table.card;
  let kicker = ''; let title = ''; let lede = '';
  let body: JSX.Element | null = null;
  const find = (id: string) => moveById(input.legalMoves, id);
  const stage = c?.stage ?? '';
  const rolling = p?.kind === 'roll';
  /** A way as the engine lists it, or shut with its reason. */
  const way = (id: string, type: string, name: string, icon: IconName, extra: { tag?: string; button?: string; fallback?: string } = {}) => {
    const m = find(id);
    const pv = previewOf(m);
    return (
      <Choice
        key={id} icon={icon} name={name} input={input} tag={extra.tag} button={extra.button}
        roll={pv?.roll} lines={[pv?.then, !pv?.roll ? m?.description : null]}
        shut={m ? undefined : (reasonFor(input.unavailable, type) ?? extra.fallback ?? '')}
        disabled={!pressable} onClick={() => m && onMove(m)}
      />
    );
  };

  if (rolling) {
    kicker = 'THE DICE DECIDE'; title = table.rollFacts?.name ?? 'Roll';
    lede = '';
  } else if (p?.kind === 'evade_offer') {
    kicker = `${face?.id.replace(/D$/, '') ?? ''}♦ DRAWN · PIRATES`; title = `${face?.title ?? 'Pirates'} drop out of the dark`;
    lede = 'They have not seen you yet.';
    body = (
      <div className="ww-ways two">
        {way('attempt-evade', 'attempt_evade', 'Run silent', 'eclipse')}
        {way('decline-evade', 'decline_evade', 'Engage', 'starfighter')}
      </div>
    );
  } else if (stage === 'loss_reroll_offer') {
    kicker = 'THE DICE ARE IN'; title = 'You lost the exchange';
    lede = 'The hit has not landed yet.';
    body = (
      <div className="ww-ways two">
        {way('accept-result', 'accept_result', 'Take the hit', 'crack')}
        {way('use-reroll', 'use_reroll', 'Roll again', 'starfighter')}
      </div>
    );
  } else if (p?.kind === 'space_combat_action') {
    kicker = 'CHOOSE ONE'; title = 'What now?';
    lede = 'You must do one of these.';
    // The ways the engine lists come first; the ones it does not follow, each with its reason.
    const order = [...EXCHANGE.filter((a) => find(a.id)), ...EXCHANGE.filter((a) => !find(a.id))];
    body = <div className="ww-ways three">{order.map((a) => way(a.id, a.type, a.name, a.icon, { tag: (a.id === 'open-fire' && c?.volleyUsed) || (a.id === 'redline' && c?.redlineUsed) ? 'tried' : undefined }))}</div>;
  } else if (p?.kind === 'boarding_decision' && asStr(p['stage']) === 'board_or_leave') {
    kicker = 'THEY ARE DISABLED'; title = 'Their engines are dark';
    body = (
      <div className="ww-ways three">
        {way('board-ship', 'board_ship', 'Board', 'suit')}
        {way('leave-pirate', 'leave_pirate', 'Leave', 'rocket', { tag: 'no roll' })}
        {way('recruit-survivors', 'recruit_survivors', 'Talk the survivors aboard', 'convince')}
      </div>
    );
  } else if (stage === 'captured' || (p?.kind === 'boarding_decision' && asStr(p['stage']) === 'take_or_abandon')) {
    const take = find('take-ship'); const keep = find('abandon-ship'); const talk = find('recruit-survivors');
    kicker = 'BOARDING WON'; title = 'Take their ship, or keep yours?';
    lede = previewOf(take)?.then ?? take?.description ?? '';
    const mine = table.ship;
    body = (
      <>
        <div className="ww-ships">
          {mine && (
            <div className="ww-ship-card">
              <div className="ww-row" style={{ gap: 12 }}><span style={{ color: '#FFD700' }}><Icon name="ship" size={40} /></span><span className="ww-col"><span className="ww-act-name">{mine.name}</span><span className="ww-dim" style={{ fontSize: 12 }}>yours</span></span></div>
              <div className="ww-col" style={{ gap: 5 }}>
                <span className="ww-kv"><span className="ww-dim">Capacity</span><Num>{mine.capacity}</Num></span>
                <span className="ww-kv"><span className="ww-dim">Speed</span><Num>{mine.speed}</Num></span>
                <span className="ww-kv"><span className="ww-dim">Handling</span><Num>{mine.handling}</Num></span>
                <span className="ww-kv"><span className="ww-dim">Armor</span><Num>{mine.armor}</Num></span>
                <span className="ww-kv"><span className="ww-dim">Damage</span><Num style={{ color: '#f2b544' }}>{mine.damage}</Num></span>
                <span className="ww-kv"><span className="ww-dim">Parts</span><Num>{mine.parts.length} fitted</Num></span>
              </div>
              <GoldButton onClick={() => keep && onMove(keep)} disabled={!pressable || !keep}>KEEP {mine.name.toUpperCase()}</GoldButton>
            </div>
          )}
          {face && (
            <div className="ww-ship-card">
              <div className="ww-row" style={{ gap: 12 }}><span style={{ color: '#ff9da1' }}><Icon name={artFor(face)} size={40} /></span><span className="ww-col"><span className="ww-act-name">{face.title}</span><span className="ww-dim" style={{ fontSize: 12 }}>captured</span></span></div>
              <div className="ww-col" style={{ gap: 5 }}>
                {(face.stats ?? []).filter((s) => s.k !== 'ground' && s.k !== 'hack').map((s) => <span key={s.k} className="ww-kv"><span className="ww-dim">{s.k === 'crew' ? 'Capacity' : s.k === 'handl.' ? 'Handling' : 'Speed'}</span><Num>{s.v.replace('+', '')}</Num></span>)}
                <span className="ww-kv"><span className="ww-dim">Damage</span><Num style={{ color: '#ff7a7f' }}>hobbled</Num></span>
                <span className="ww-kv"><span className="ww-dim">Parts</span><Num style={{ color: '#ff9da1' }}>none</Num></span>
              </div>
              <GoldButton onClick={() => take && onMove(take)} disabled={!pressable || !take}>TAKE THE SHIP</GoldButton>
            </div>
          )}
        </div>
        {(talk || reasonFor(input.unavailable, 'recruit_survivors')) && <div className="ww-ways two">{way('recruit-survivors', 'recruit_survivors', 'Talk the survivors aboard', 'convince')}</div>}
      </>
    );
  }

  return (
    <div className="ww-main">
      <div className="ww-main-card">
        <div className="ww-card-and">
          <div className="ww-card-side"><PirateCard table={table} /></div>
          <div className="ww-col" style={{ gap: 14, minWidth: 0, flex: 1 }}>
            <div className="ww-col" style={{ gap: 4 }}>
              <Lbl style={{ color: '#ff9da1' }}>{kicker}</Lbl>
              <h1 className="ww-h1">{title}</h1>
              {lede && <span className="ww-lede">{lede}</span>}
            </div>
          </div>
        </div>
        {rolling && <RollPanel {...props} />}
        {body}
      </div>
    </div>
  );
}

export const isPirateMoment = (table: WwTable): boolean => {
  const p = table.pending;
  return table.phase === 'space_combat' || !!table.combat || p?.kind === 'evade_offer' || (p?.kind === 'roll' && asStr(p['reason']) === 'evade');
};
