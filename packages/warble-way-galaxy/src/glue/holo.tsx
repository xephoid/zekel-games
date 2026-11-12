// A portrait as a hologram (docs/games/warble-way-galaxy-theme-build.md,
// item 3): two stacked copies of the same picture, a ghost under the main
// image, both carrying the theme's filter (gold for crew and recruits, red
// for attackers and pirates) and both jumping now and then, the way the
// icons do. The ghost is hue-shifted to magenta under gold and cyan under
// red; the main copy screens over it. The rules are the `.ww-gxi` block in
// ww.css. The wrapper is sized here, because a percentage-sized image inside
// an unsized grid grows to the file's 256 px. Pictures only.

import type { CSSProperties } from 'react';

export type HoloKind = 'gold' | 'red';

export function Hologram({ src, kind = 'gold', size = 40, label, round = true, className, style }: {
  src: string;
  kind?: HoloKind;
  size?: number | string;
  /** What the picture is of, said to a reader; without it the hologram is decoration. */
  label?: string;
  round?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const box: CSSProperties = { width: size, height: size };
  const img: CSSProperties = { ...box, objectFit: 'cover', borderRadius: round ? '50%' : undefined };
  const tint = kind === 'red' ? 'ww-ga-red' : 'ww-ga';
  return (
    <span className={['ww-gxi', className].filter(Boolean).join(' ')} style={{ ...box, ...style }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <img className={`${tint} ww-gh`} src={src} alt="" aria-hidden="true" style={img} />
      <img className={tint} src={src} alt="" style={img} />
    </span>
  );
}
