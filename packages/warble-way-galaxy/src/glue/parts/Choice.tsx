// One way to go, as a box: its name, the chance when it leads to a roll,
// what the engine says it does, and one button that takes it. Used wherever
// a card or a fight puts several ways side by side. A way the engine does
// not list is drawn shut, with the engine's reason when it gave one.

import type { GlueInput } from '@zekel/glue-kit';
import type { RollFacts } from '../facts.js';
import { Icon, type IconName } from '../icons.js';
import { Chance, OddsLine, Stakes } from './Facts.js';

export interface ChoiceProps {
  icon: IconName;
  name: string;
  /** a word beside the name when there is no chance to show: "safe", "tried" */
  tag?: string;
  /** the roll it leads to, when it leads to one */
  roll?: RollFacts;
  /** what else the engine says about it */
  lines?: Array<string | null | undefined>;
  /** why it cannot be taken; draws the box shut */
  shut?: string | null;
  /** the button's words; the name when absent */
  button?: string;
  colour?: string;
  input: GlueInput;
  disabled?: boolean;
  onClick?: () => void;
}

export function Choice({ icon, name, tag, roll, lines = [], shut, button, colour, input, disabled, onClick }: ChoiceProps) {
  const off = shut !== undefined && shut !== null;
  const text = lines.filter((l): l is string => !!l);
  return (
    <div className={`ww-way${off ? ' off' : ''}`}>
      <div className="ww-way-head">
        <span style={{ color: off ? '#56609a' : (colour ?? '#FFD700'), flex: 'none' }}><Icon name={icon} size={30} /></span>
        <span className="ww-act-name" style={{ flex: 1 }}>{name}</span>
        {roll && !off ? <Chance chance={roll.chance} /> : tag ? <span className="ww-act-tag">{tag}</span> : null}
      </div>
      {text.map((l) => <span key={l} className="ww-way-line">{l}</span>)}
      {roll && !off && <><span className="ww-way-line" title={roll.pairing?.why}><OddsLine facts={roll} input={input} brief /></span><Stakes facts={roll} brief /></>}
      {off && <span className="ww-way-line shut">{shut || 'Not on offer right now.'}</span>}
      {!off && <button type="button" className="ww-way-btn" disabled={disabled} onClick={onClick} aria-label={name}>{button ?? name}</button>}
    </div>
  );
}
