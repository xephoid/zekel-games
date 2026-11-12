// A Warble Way Galaxy travel card, 200 × 290, as Cards.dc.html draws it
// (build item 4): a band in the kind's colour with its icon and the card
// code, a dashed scanner ring holding one icon or a recruit's portrait, the
// name and a line, then the kind's own block at the foot: what a recruit
// needs and brings, a pirate ship's numbers, a ruin's depth in pips, or one
// row per way through a hazard or a job. Everything on the face comes from
// the engine's reference data through cards.ts; this file only lays it out.

import { KIND, GLYPH, FAIL_ICON, artFor, type TravelCardFace } from './cards.js';
import { faceUrl } from './faces.js';
import { Hologram } from './holo.js';
import { Icon } from './icons.js';

export function TravelCard({ face, className }: { face: TravelCardFace; className?: string }) {
  const kind = KIND[face.kind];
  const code = `${GLYPH[face.suit]} ${face.rank}`;
  const portrait = face.kind === 'recruit' && face.race ? faceUrl(face.race) : undefined;
  return (
    <div className={['ww-tc', className].filter(Boolean).join(' ')} data-kind={face.kind} data-card={face.id} style={{ '--ww-kind': kind.colour } as React.CSSProperties} role="group" aria-label={`${face.title}, ${kind.word.toLowerCase()} ${code}`}>
      <div className="ww-tc-band">
        <span className="ww-tc-kind"><Icon name={kind.icon} size={15} /><span>{kind.word}</span></span>
        <span className="ww-tc-code">{code}</span>
      </div>
      <div className="ww-tc-pic">
        <div className="ww-tc-ring">
          {portrait ? <Hologram src={portrait} size={84} /> : <Icon name={artFor(face)} size={64} />}
        </div>
      </div>
      <div className="ww-tc-head">
        <span className="ww-tc-title">{face.title}</span>
        {face.line && <span className="ww-tc-line">{face.line}</span>}
      </div>
      <div className="ww-tc-foot">
        {face.kind === 'recruit' && (
          <div className="ww-tc-recruit">
            <span className="ww-tc-stat"><span className="ww-tc-small">need</span><span className="ww-tc-big">{face.need}</span></span>
            <span className="ww-tc-chips">{(face.chips ?? []).map((c) => <span key={c} className="ww-tc-chip">{c}</span>)}</span>
          </div>
        )}
        {face.kind === 'pirate' && (
          <div className="ww-tc-pirate">
            <span className="ww-tc-attack"><span className="ww-tc-big">+{face.spaceAttack}</span><span className="ww-tc-small">space attack</span></span>
            <div className="ww-tc-grid">
              {(face.stats ?? []).map((s) => <span key={s.k} className="ww-tc-cell"><span className="ww-tc-v">{s.v}</span><span className="ww-tc-tiny">{s.k}</span></span>)}
            </div>
          </div>
        )}
        {face.kind === 'ruin' && (
          <div className="ww-tc-ruin">
            <span className="ww-tc-stat"><span className="ww-tc-small">depth</span><span className="ww-tc-big">{face.depth}</span></span>
            <span className="ww-tc-pips" aria-hidden="true">{[1, 2, 3].map((i) => <span key={i} className={i <= (face.depth ?? 0) ? 'ww-tc-pip on' : 'ww-tc-pip'} />)}</span>
          </div>
        )}
        {(face.options ?? []).map((o, i) => (
          <div key={i} className="ww-tc-row">
            <span className="ww-tc-row-head">{o.head}</span>
            <span className="ww-tc-row-tail">{o.fail && <Icon name={FAIL_ICON[o.fail]} size={13} />}{o.tail}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The back of every travel card: the gold swirl, the same mark as a ruin's goal. */
export function TravelCardBack({ className }: { className?: string }) {
  return (
    <div className={['ww-tc ww-tc-back', className].filter(Boolean).join(' ')} aria-hidden="true">
      <div className="ww-tc-back-inner">
        <Icon name="swirl" size={92} />
        <span className="ww-tc-back-word">WARBLE<br />WAY</span>
        <Icon name="nightsky" size={120} className="ww-tc-back-sky" />
      </div>
    </div>
  );
}
