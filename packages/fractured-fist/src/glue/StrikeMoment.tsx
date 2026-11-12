// The strike as a moment (docs/design/fractured-fist-arcade, Strike-Prototype
// and Strike-Storyboard): both hits run at the same time, in five beats over
// the board as it still is, then the overlay hands the table back so the
// event lands and the played rows sweep to the discards. Nothing here asks
// the player anything; the only presses are pace and skip. Every number is
// the glue's reading of the engine's before and after views: what was
// queued, what was in the way, and what got through (the stamina the engine
// took off, never worked out here).
//
// The beats: locked (the banner, both fighters and their queued hits pop
// up), travel (the hits fly across and cross with a flash), absorb (each
// shield flares, a Block tag drops, each hit shrinks to what got through),
// land (what got through bursts on the target, its plate shakes, the lost
// blocks break off one at a time; a hit stopped whole gets "Blocked!"), and
// fade (the fighters slide out and the board comes back).

import { useEffect, useState } from 'react';
import { motionMs } from '@zekel/tokens';
import { PaceControl, type Moment, type MomentProps } from '@zekel/glue-kit';

/** One hit of a strike: what was queued, what was in the way, what the
 *  engine says got through, and the target's meter before and after. */
export interface StrikeLane {
  /** engine player ids; the table names them from the seats */
  attacker: string;
  target: string;
  hit: number;
  shield: number;
  /** read from the engine's result, never computed here */
  through: number;
  before: number;
  after: number;
  max: number;
}

/** The strike as the table's moment: both hits, and whether it ended the fight. */
export interface StrikeMoment extends Moment { kind: 'strike'; lanes: StrikeLane[] }

/** Beat lengths at 1×, in the motion tokens. */
export const STRIKE_BEATS = {
  locked: motionMs.slow + motionMs.flip,
  travel: motionMs.tumble,
  absorb: motionMs.slow + motionMs.fast,
  land: motionMs.tumble,
  fade: motionMs.drop,
} as const;

const ORDER = ['locked', 'travel', 'absorb', 'land', 'fade'] as const;
type Beat = 0 | 1 | 2 | 3 | 4 | 5;

const CAPTIONS: Record<number, string> = {
  1: 'Both hits are locked in. They land at the same time.',
  2: 'The hits travel.',
  4: 'What gets through comes off stamina.',
  5: 'Both played rows sweep into the discards.',
};

/** What a shield took, shown and never used for anything: the difference
 *  between what was queued and what the engine let through. */
function absorbedOf(l: StrikeLane): number {
  return Math.max(0, Math.min(l.shield, l.hit - l.through));
}

/** The table draws this over the board whenever momentFor found a strike
 *  (GlueModule.Moment); the moment it gets is always the strike's own. */
export function StrikeOverlay({ moment: m, nameFor, youPid, pace, setPace, onDone, reduced }: MomentProps) {
  const moment = m as StrikeMoment;
  const [beat, setBeat] = useState<Beat>(0);
  const [skipped, setSkipped] = useState(false);

  // One timer per beat; the pace scales every beat the same way.
  useEffect(() => {
    if (skipped) return;
    if (beat === 0) { setBeat(1); return; }
    if (beat >= 5) { const t = setTimeout(onDone, STRIKE_BEATS.fade / pace); return () => clearTimeout(t); }
    const name = ORDER[beat - 1]!;
    const t = setTimeout(() => setBeat((b) => (b + 1) as Beat), STRIKE_BEATS[name] / pace);
    return () => clearTimeout(t);
  }, [beat, pace, skipped, onDone]);

  const skip = () => { setSkipped(true); setBeat(5); onDone(); };
  const label = (pid: string) => (pid === youPid ? 'You' : nameFor(pid));
  const absorbLine = moment.lanes.map((l) => {
    const blocker = label(l.target);
    const absorbed = absorbedOf(l);
    return absorbed > 0 ? `${blocker} block${blocker === 'You' ? '' : 's'} ${absorbed}.` : `${blocker} ${blocker === 'You' ? 'have' : 'has'} no defense up.`;
  }).join(' ');
  const caption = beat === 3 ? absorbLine : (CAPTIONS[beat] ?? '');

  // Two fighters facing each other: you on the left when you are in it.
  const pids = [...new Set(moment.lanes.flatMap((l) => [l.attacker, l.target]))];
  const leftPid = youPid && pids.includes(youPid) ? youPid : pids[0] ?? '';
  const rightPid = pids.find((p) => p !== leftPid) ?? leftPid;
  const inbound = (pid: string) => moment.lanes.find((l) => l.target === pid);
  const outbound = (pid: string) => moment.lanes.find((l) => l.attacker === pid);
  const round = moment.title.split(' · ')[0] ?? moment.title;
  const durations = {
    travel: STRIKE_BEATS.travel / pace, absorb: STRIKE_BEATS.absorb / pace, land: STRIKE_BEATS.land / pace, fade: STRIKE_BEATS.fade / pace,
  };

  return (
    <div className={`strike-scrim beat-${beat}${beat >= 5 ? ' closing' : ''}${reduced ? ' reduced' : ''}`} role="presentation" style={{ transitionDuration: `${durations.fade}ms` }}>
      <div className="strike-panel" role="dialog" aria-label={moment.title}>
        <div className="strike-banner"><span>{round}</span><b>Strike!</b></div>
        <div className="strike-arena">
          {[leftPid, rightPid].map((pid, i) => (
            <Fighter key={pid} side={i === 0 ? 'left' : 'right'} name={label(pid)} inbound={inbound(pid)} beat={beat} durations={durations} />
          ))}
          {[leftPid, rightPid].map((pid, i) => {
            const lane = outbound(pid);
            return lane ? <Hit key={`hit:${pid}`} side={i === 0 ? 'left' : 'right'} lane={lane} who={label(lane.attacker)} whom={label(lane.target)} beat={beat} durations={durations} /> : null;
          })}
          <span className={`strike-flash${beat === 2 ? ' on' : ''}`} style={{ animationDuration: `${durations.travel}ms` }} aria-hidden="true" />
          {moment.over && beat >= 4 && <span className="strike-ko" aria-hidden="true">K.O.</span>}
        </div>
        <p className="strike-caption" aria-live="polite">{caption}</p>
        <div className="strike-controls">
          <span className="muted" style={{ fontSize: 12 }}>Pace</span>
          <PaceControl pace={pace} setPace={setPace} />
          <span style={{ flex: 1 }} />
          <button className="btn secondary small" onClick={skip}>Skip to the end</button>
        </div>
      </div>
    </div>
  );
}

type Durations = { travel: number; absorb: number; land: number; fade: number };

/** One fighter: their plate with the stamina they had and what is left once
 *  the hit lands, and the shield in front of them. */
function Fighter({ side, name, inbound, beat, durations }: {
  side: 'left' | 'right'; name: string; inbound: StrikeLane | undefined; beat: Beat; durations: Durations;
}) {
  const landed = beat >= 4;
  const before = Math.max(0, inbound?.before ?? 0);
  const after = Math.max(0, inbound?.after ?? before);
  const max = Math.max(0, inbound?.max ?? before);
  const hit = inbound?.hit ?? 0;
  const through = inbound?.through ?? 0;
  const absorbed = inbound ? absorbedOf(inbound) : 0;
  const stamina = landed ? after : before;
  const stopped = landed && hit > 0 && through === 0;
  return (
    <>
      <div className={`strike-fighter ${side}${landed && through > 0 ? ' struck' : ''}`} style={{ animationDuration: `${durations.land}ms` }}>
        <span className="strike-badge" aria-hidden="true"><span>{name.slice(0, 1)}</span></span>
        <div className="strike-fighter-body">
          <span className="strike-fighter-name">{name}</span>
          <div className="strike-pips" aria-label={`${name}: ${stamina} of ${max}`}>
            {Array.from({ length: max }, (_, i) => {
              const full = i < after;
              const lost = !full && i < before;
              const cls = ['strike-pip', (full || (lost && !landed)) && 'full', lost && landed && 'out'].filter(Boolean).join(' ');
              // The lost blocks break off one at a time, the nearest first.
              const order = before - 1 - i;
              return <span key={i} className={cls} style={lost ? { transitionDelay: `${(order * motionMs.fast * durations.land) / STRIKE_BEATS.land}ms`, transitionDuration: `${durations.land}ms` } : undefined} />;
            })}
          </div>
        </div>
        <span className={`strike-stam${landed ? ' tick' : ''}`} aria-hidden="true"><b>{stamina}</b>/{max}</span>
      </div>
      <div className={`strike-shield ${side}${beat === 3 && absorbed > 0 ? ' flare' : ''}`} style={{ animationDuration: `${durations.absorb}ms` }}>
        <b>{inbound?.shield ?? 0}</b><span>Defense</span>
        {absorbed > 0 && beat >= 3 && <span className="strike-block-tag" style={{ animationDuration: `${durations.absorb}ms` }}>Block {absorbed}</span>}
        {stopped && <span className="strike-stamp">Blocked!</span>}
      </div>
      {landed && through > 0 && <span className={`strike-impact ${side}`} style={{ animationDuration: `${durations.land}ms` }}>−{through}</span>}
    </>
  );
}

/** One hit: pops up by its owner, flies across, shrinks to what got through,
 *  and is gone once it lands. */
function Hit({ side, lane, who, whom, beat, durations }: { side: 'left' | 'right'; lane: StrikeLane; who: string; whom: string; beat: Beat; durations: Durations }) {
  // Nothing queued and nothing through: there is no hit to draw.
  if (lane.hit === 0 && lane.through === 0) return null;
  const shown = beat <= 2 ? lane.hit : lane.through;
  const at = beat <= 1 ? 'home' : beat <= 3 ? 'across' : 'in';
  const ms = beat === 2 ? durations.travel : beat === 3 ? durations.absorb : durations.land;
  return (
    <span
      className={`strike-hit ${side} at-${at}${beat >= 3 && lane.through < lane.hit ? ' shrunk' : ''}${beat >= 4 ? ' gone' : ''}`}
      style={{ transitionDuration: `${ms}ms` }}
      role="img"
      aria-label={`${who} hit${who === 'You' ? '' : 's'} ${whom === 'You' ? 'you' : whom}: ${lane.hit} queued${beat >= 3 ? `, ${lane.through} got through` : ''}`}
    >
      <span>{shown}</span>
    </span>
  );
}
