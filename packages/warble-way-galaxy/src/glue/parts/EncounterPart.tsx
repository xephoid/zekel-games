// Space encounters (Encounter.dc.html, build item 5): a recruit adrift, a
// job offer with the legs it would add, a ruin found. The card sits beside
// the choice and the captain's sheet stays on the left, so the scores a
// choice turns on are on screen while it is made. Each way shows what the
// engine says it leads to; a way the engine does not list is drawn shut
// with the engine's reason.

import type { LegalMove } from '@zekel/glue-kit';
import { asNum, asStr } from '@zekel/glue-kit';
import { KIND } from '../cards.js';
import { previewOf, reasonFor, words } from '../facts.js';
import { Icon } from '../icons.js';
import { moveById, type WwTable } from '../read.js';
import { TravelCard } from '../TravelCard.js';
import { Lbl, Num, missionTitles } from '../ui.js';
import { Choice } from './Choice.js';
import { RollPanel } from './RollPanel.js';
import type { PartProps } from './SpacePart.js';

function Legs({ head, legs }: { head: string; legs: Array<{ name: string; n: string; icon: 'idcard' | 'silo' | 'rocket' | 'ringed'; colour?: string; lit?: boolean }> }) {
  return (
    <section className="ww-section">
      <Lbl style={{ fontSize: 11, color: '#b9bdd4' }}>{head}</Lbl>
      {legs.map((l, i) => (
        <div key={i} className={`ww-leg${l.lit ? ' current' : ''}`} style={!l.lit ? { background: '#283063', border: '1px solid #4f5a94', color: '#c9cfee' } : undefined}>
          <span style={{ color: l.lit ? undefined : (l.colour ?? '#aab1d3') }}><Icon name={l.icon} size={18} /></span>
          <span style={{ flex: 1 }}>{l.name}</span><Num>{l.n}</Num>
        </div>
      ))}
    </section>
  );
}

export function EncounterPart(props: PartProps) {
  const { table, input, pressable, onMove } = props;
  const face = table.card;
  const p = table.pending;
  if (!face || !p) return null;
  const kind = KIND[face.kind];
  let kicker = ''; let title = ''; let lede = '';
  let ways: JSX.Element[] = [];
  let extra: JSX.Element | null = null;
  const titles = missionTitles(input.reference);
  const rolling = p.kind === 'roll';
  const flyOn = (id: string, name: string) => {
    const m = moveById(input.legalMoves, id);
    return <Choice key={id} icon="rocket" name={name} tag="no roll" input={input} lines={[m?.description]} shut={m ? undefined : ''} disabled={!pressable} onClick={() => m && onMove(m)} />;
  };

  if (p.kind === 'space_recruit_offer' || (rolling && asStr(p['reason']) === 'recruit')) {
    kicker = 'SOMEONE ADRIFT'; title = `${face.title} is hailing you`;
    lede = `${face.line}.${face.chips?.length ? ` Brings ${face.chips.join(', ')}.` : ''}${table.ship ? ` ${1 + table.crew.length} of ${table.ship.capacity} aboard.` : ''}`;
    if (!rolling) {
      const tryM = moveById(input.legalMoves, 'attempt-space-recruit');
      const pv = previewOf(tryM);
      ways = [
        <Choice key="try" icon="convince" name="Try to recruit" colour={kind.colour} input={input} roll={pv?.roll} lines={[!pv?.roll ? `Need ${face.need ?? '?'} on three dice plus the best ${face.idealized ?? ''} score aboard.` : null]} shut={tryM ? undefined : ''} disabled={!pressable} onClick={() => tryM && onMove(tryM)} />,
        flyOn('decline-recruit', 'Fly on'),
      ];
    }
  } else if (p.kind === 'space_mission_offer') {
    const ruinJob = (face.options ?? []).length === 1;
    kicker = ruinJob ? 'A RUIN EXPEDITION' : 'A JOB IN THE MIDDLE OF NOWHERE';
    title = ruinJob ? `Follow ${face.title}?` : `Take ${face.title}?`;
    lede = face.line ?? '';
    let then = '';
    ways = (face.options ?? []).map((o, i) => {
      const m = moveById(input.legalMoves, `accept-mission-${i + 1}`);
      const pv = previewOf(m);
      if (pv?.then && !then) then = pv.then;
      return <Choice key={i} icon={ruinJob ? 'conquest' : i === 0 ? 'convince' : 'satcom'} name={ruinJob ? 'Accept' : `Way ${i + 1}: ${o.head}`} colour={kind.colour} input={input} roll={pv?.check} lines={[`${o.tail}.`, pv?.then]} shut={m ? undefined : (reasonFor(input.unavailable, 'accept_mission', `option-${i + 1}`) ?? '')} disabled={!pressable} onClick={() => m && onMove(m)} />;
    });
    ways.push(flyOn('decline-mission', 'Decline'));
    const current = table.journey.find((l) => l.current);
    const dist = (face.options ?? [])[0]?.tail.match(/dist (\d+)/)?.[1];
    const each = dist ? Math.max(0, Number(dist) - (table.ship?.speed ?? 0)) : null;
    const currentWords = current ? (current.kind === 'habitat_transfer' ? current.purpose.replace(/^one-way transfer to /, 'to ') : `${current.kind === 'mission_outbound' ? 'out to' : 'back from'} ${(current.missionId && titles[current.missionId]) || current.purpose.replace(/^(outbound|return) — /, '')}`) : '';
    extra = (
      <Legs head="YOUR JOURNEY IF YOU ACCEPT, TOP FIRST" legs={[
        { name: `Out · ${face.title}`, n: each !== null ? String(each) : '', icon: 'idcard', lit: true },
        ...(ruinJob ? [{ name: `Ruin · ${(face.options ?? [])[0]?.head ?? ''}`, n: 'map', icon: 'silo' as const, colour: '#f2b544' }] : []),
        { name: `Back · ${face.title}`, n: each !== null ? String(each) : '', icon: 'idcard' },
        ...table.journey.map((l) => ({ name: l.current ? `Then · ${currentWords}` : `Then · ${l.kind === 'habitat_transfer' ? l.purpose.replace(/^one-way transfer to /, 'to ') : `${l.kind === 'mission_outbound' ? 'out to' : 'back from'} ${(l.missionId && titles[l.missionId]) || ''}`}`, n: String(l.cardsRemaining), icon: 'rocket' as const })),
      ]} />
    );
  } else if (p.kind === 'ruin_discovery') {
    const max = asNum(p['max_depth'], face.depth ?? 1);
    const rt = words(input.reference, 'ruin_text');
    kicker = 'RUINS ON THE SCANNER'; title = `Enter ${face.title}?`;
    lede = `${face.line ?? ''} It goes ${max} ${max === 1 ? 'map' : 'maps'} deep. Entering is yours to choose.`;
    const depths = [1, 2, 3].map((d) => ({ d, m: moveById(input.legalMoves, `enter-ruin-${d}`) })).filter((x) => x.m);
    ways = [
      ...depths.map(({ d, m }) => <Choice key={d} icon="silo" name={`Enter, to depth ${d}`} colour={kind.colour} input={input} lines={[m!.description]} disabled={!pressable} onClick={() => onMove(m!)} />),
      flyOn('skip-ruin', 'Fly on'),
    ];
    const then = previewOf(depths[0]?.m)?.then;
    extra = (then || rt['goal']) ? (
      <section className="ww-section">
        <Lbl style={{ fontSize: 11, color: '#b9bdd4' }}>BEFORE YOU GO IN</Lbl>
        {[then, rt['round'], rt['struck'], rt['cache'], rt['goal']].filter(Boolean).map((l) => <span key={l} style={{ fontSize: 13, lineHeight: 1.45, color: '#c9cfee' }}>{l}</span>)}
      </section>
    ) : null;
  }

  return (
    <div className="ww-main">
      <div className="ww-main-card">
        <div className="ww-card-and">
          <div className="ww-card-side"><div className="ww-live"><TravelCard face={face} /></div></div>
          <div className="ww-col" style={{ gap: 14, minWidth: 0, flex: 1 }}>
            <div className="ww-col" style={{ gap: 4 }}>
              <Lbl style={{ color: kind.colour }}>{kicker}</Lbl>
              <h1 className="ww-h1">{title}</h1>
              <span className="ww-lede">{lede}</span>
            </div>
          </div>
        </div>
        {rolling && <RollPanel {...props} />}
        {ways.length > 0 && <div className={`ww-ways ${ways.length >= 3 ? 'three' : 'two'}`}>{ways}</div>}
        {extra}
      </div>
    </div>
  );
}

export const isEncounterPending = (p: { kind: string; [k: string]: unknown } | null, phase: string): boolean =>
  !!p && (p.kind === 'space_recruit_offer' || p.kind === 'space_mission_offer' || p.kind === 'ruin_discovery' || (p.kind === 'roll' && asStr(p['reason']) === 'recruit' && phase === 'traveling'));

export type { LegalMove, WwTable };
