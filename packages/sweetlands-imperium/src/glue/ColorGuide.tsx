// The color guide (build item 7): always on screen, one row per color with
// its swatch, the action, who it helps most and one plain sentence. The row
// for the picked card's color is outlined.

import { COLOR_ACTION, COLORS, cap, type SlColor } from './colors.js';

export function ColorGuide({ highlight }: { highlight: string | null }) {
  return (
    <section className="sl-panel sl-guide" aria-label="What each color does">
      <h2 className="sl-h">What each color does</h2>
      <ul>
        {COLORS.map((c: SlColor) => {
          const a = COLOR_ACTION[c];
          return (
            <li key={c} className={highlight === c ? 'on' : undefined} aria-current={highlight === c ? 'true' : undefined}>
              <span className={`sl-swatch sl-guide-swatch sl-c-${c}`} />
              <span>
                <span className="sl-guide-name"><b>{cap(c)} · {a.name}</b> <span>· {a.who}</span></span>
                <span className="sl-guide-text">{a.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
