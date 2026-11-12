// The candy theme's drawings, from docs/design/sweetlands-candy/Table.dc.html:
// each faction's home, the treat shape its pieces take, the picture that says
// which piece it is, the castle, the crossroads signpost, the sugar cube and
// the chocolate road arrow. Pictures only; nothing here knows a rule.

import type { ReactNode } from 'react';

export type FactionKey = 'milkshake' | 'fudge' | 'jellybean' | 'cheesecake';
export type UnitKey = 'leader' | 'knight' | 'ambassador';

const CHOC = '#5a3214';
const INK = '#3d200b';

/** Each leader's home, drawn on the start tile (36 × 34). */
export function Home({ faction, label }: { faction: FactionKey; label: string }) {
  const common = { width: 36, height: 34, viewBox: '0 0 36 34', stroke: CHOC, strokeWidth: 1.4, strokeLinejoin: 'round' as const, role: 'img', 'aria-label': label, className: 'sl-home-art' };
  switch (faction) {
    case 'milkshake':
      return (
        <svg {...common}><path d="M7 33l3-17h16l3 17z" fill="#ffd6e6" /><path d="M8 32.5h20" stroke="#ff9ec0" strokeWidth="2" /><path d="M6 17a6 6 0 0 1 8-6 5.5 5.5 0 0 1 8 0 6 6 0 0 1 8 6z" fill="#fff8ec" /><path d="M12 11.5a6 6 0 0 1 12 0" fill="#ffd6e6" /><circle cx="18" cy="4.6" r="2.6" fill="#ff004d" /><path d="M15.5 33v-6a2.5 2.5 0 0 1 5 0v6" fill="#f5a623" /></svg>
      );
    case 'fudge':
      return (
        <svg {...common}><path d="M5 33V14h4v-3h4v3h3v-3h4v3h3v-3h4v3h4v19z" fill="#8b5a2b" /><path d="M14 11V3h8v8" fill="#6b3d1a" /><path d="M14 3h8l-4-3z" fill="#6b3d1a" /><path d="M22 4h6l-1.5 2 1.5 2h-6z" fill="#ffa300" /><path d="M7 20h22M7 26h22M18 14v6M12 20v6M24 20v6" fill="none" stroke="#c99062" strokeWidth="1" /><path d="M15 33v-5a3 3 0 0 1 6 0v5" fill={INK} /></svg>
      );
    case 'jellybean':
      return (
        <svg {...common}><path d="M9 33V20h18v13z" fill="#fff0f6" /><path d="M4 21c0-9 6-15 14-15s14 6 14 15z" fill="#ff9ec0" /><ellipse cx="11" cy="14.5" rx="2.8" ry="1.7" fill="#00e436" strokeWidth="1" transform="rotate(-30 11 14.5)" /><ellipse cx="18" cy="10.5" rx="2.8" ry="1.7" fill="#ffec27" strokeWidth="1" /><ellipse cx="25" cy="14.5" rx="2.8" ry="1.7" fill="#29adff" strokeWidth="1" transform="rotate(30 25 14.5)" /><path d="M15 33v-6a3 3 0 0 1 6 0v6" fill="#9013fe" /><path d="M2 33c0-4 1-7 2.5-9M33.5 33c0-4-1-7-2.5-9" fill="none" stroke="#00b82c" strokeWidth="1.6" strokeLinecap="round" /><circle cx="4.6" cy="23.4" r="1.6" fill="#00e436" /><circle cx="31" cy="23.4" r="1.6" fill="#00e436" /></svg>
      );
    case 'cheesecake':
      return (
        <svg {...common}><path d="M6 33V13h24v20z" fill="#fffaf0" /><path d="M6 29.5h24V33H6z" fill="#c98a4b" /><path d="M6 13h24v2.4c-2 0-2 2-4 2s-2-2.2-4-2.2-2 2.6-4 2.6-2-2.6-4-2.6-2 2.2-4 2.2-2-2-4-2z" fill="#ff004d" /><path d="M11 13V7a7 7 0 0 1 14 0v6" fill="#f0e2c4" /><circle cx="18" cy="2.6" r="2.4" fill="#ff004d" /><path d="M15 33v-7a3 3 0 0 1 6 0v7" fill="#8b5a2b" /><circle cx="11" cy="22" r="1.4" fill="#ffd6e6" /><circle cx="25" cy="22" r="1.4" fill="#ffd6e6" /></svg>
      );
  }
}

/** The treat shape every piece of a faction takes, with its white halo (24 × 24 units). */
export function TreatShape({ faction }: { faction: FactionKey }): ReactNode {
  switch (faction) {
    case 'milkshake':
      return (
        <>
          <path d="M6 10.5h12l-1.8 11.5H7.8z M4.5 11a3.2 3.2 0 0 1 3-3.4A4.5 4.5 0 0 1 16.5 7.6a3.2 3.2 0 0 1 3 3.4z" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinejoin="round" />
          <path d="M14.6 8l2.8-6" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
          <path d="M14.6 8l2.8-6" stroke="#ff4f8b" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M6 10.5h12l-1.8 11.5H7.8z" fill="#f5a623" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M4.5 11a3.2 3.2 0 0 1 3-3.4A4.5 4.5 0 0 1 16.5 7.6a3.2 3.2 0 0 1 3 3.4z" fill="#fff8ec" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <circle cx="10.6" cy="5.4" r="1.8" fill="#ff004d" stroke={INK} strokeWidth="1" />
        </>
      );
    case 'fudge':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="3.5" fill="none" stroke="#ffffff" strokeWidth="4.5" />
          <rect x="3" y="3" width="18" height="18" rx="3.5" fill="#8b5a2b" stroke={INK} strokeWidth="1.6" />
          <path d="M6.2 6.3h11.6" stroke="#c99062" strokeWidth="1.8" strokeLinecap="round" />
        </>
      );
    case 'jellybean':
      return (
        <>
          <path d="M8 3.6C12.6 1.8 19.4 3.4 21 9c1.5 5.4-1.6 11.4-7.6 11.6-3.5.1-4.3-2.3-7.2-2.8C2.6 17.2 2 14.2 2.6 11 3.3 7.3 4.8 4.9 8 3.6z" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinejoin="round" />
          <path d="M8 3.6C12.6 1.8 19.4 3.4 21 9c1.5 5.4-1.6 11.4-7.6 11.6-3.5.1-4.3-2.3-7.2-2.8C2.6 17.2 2 14.2 2.6 11 3.3 7.3 4.8 4.9 8 3.6z" fill="#9013fe" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <ellipse cx="7.6" cy="7.2" rx="2.6" ry="1.2" fill="#ffffff" opacity=".55" transform="rotate(-35 7.6 7.2)" />
        </>
      );
    case 'cheesecake':
      return (
        <>
          <path d="M3 8h18v13.5H3z" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinejoin="round" />
          <circle cx="12" cy="5.6" r="2.3" fill="none" stroke="#ffffff" strokeWidth="4" />
          <path d="M3 8h18v13.5H3z" fill="#f7f2e6" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M3 19.4h18v2.1H3z" fill="#c98a4b" stroke={INK} strokeWidth="1.1" />
          <path d="M3 8h18v1.6c-1.4 0-1.4 1.5-2.8 1.5S16.8 9.6 15.4 9.6 14 11.3 12.6 11.3 11.2 9.6 9.8 9.6 8.4 11.1 7 11.1 5.6 9.6 4.2 9.6 3 10 3 10z" fill="#ff004d" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
          <circle cx="12" cy="5.6" r="2.3" fill="#ff004d" stroke={INK} strokeWidth="1.1" />
        </>
      );
  }
}

/** Where the picture sits inside each shape: centre x, centre y (of 24) and its size as a share of the piece. */
const GLYPH: Record<FactionKey, [number, number, number]> = {
  milkshake: [12, 16.4, 0.44], fudge: [12, 13, 0.52], jellybean: [12.2, 11.8, 0.48], cheesecake: [12, 15.1, 0.44],
};
/** The picture's color: dark on the light treats, white on the dark ones. */
const GLYPH_INK: Record<FactionKey, string> = { milkshake: INK, fudge: '#ffffff', jellybean: '#ffffff', cheesecake: INK };

/** Crown = Leader, sword = Knight, wrapped candy = Ambassador. */
function Glyph({ unit }: { unit: UnitKey }) {
  switch (unit) {
    case 'leader':
      return <><path d="M4.5 18L3 9.5l5 3.5 4-7 4 7 5-3.5-1.5 8.5z" /><circle cx="3" cy="8" r="2.2" /><circle cx="12" cy="4.2" r="2.4" /><circle cx="21" cy="8" r="2.2" /><rect x="4.5" y="18.8" width="15" height="2.6" rx="1.3" /></>;
    case 'knight':
      return <><path d="M19.6 2.6l1.8-.2-.2 1.8-9.4 9.4-1.6-1.6z" /><path d="M5.8 11.2l1.4-1.4 7 7-1.4 1.4z" /><path d="M8.6 15.4l1.4 1.4-4.2 4.2a1 1 0 0 1-1.4-1.4z" /><circle cx="3.6" cy="20.4" r="1.6" /></>;
    case 'ambassador':
      return <><ellipse cx="12" cy="12" rx="6.2" ry="4.8" /><path d="M6.6 12L1.2 7v10z" /><path d="M17.4 12l5.4-5v10z" /></>;
  }
}

/** A piece: its faction's treat with the picture of which piece it is, one SVG. */
export function PieceArt({ faction, unit, size }: { faction: FactionKey; unit: UnitKey; size: number }) {
  const [cx, cy, share] = GLYPH[faction];
  const g = 24 * share;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" overflow="visible" aria-hidden="true" className="sl-piece-art">
      <TreatShape faction={faction} />
      <svg x={cx - g / 2} y={cy - g / 2} width={g} height={g} viewBox="0 0 24 24" fill={GLYPH_INK[faction]}>
        <Glyph unit={unit} />
      </svg>
    </svg>
  );
}

/** The treat shape alone, for labels and the How to play page. */
export function TreatChip({ faction, size = 18 }: { faction: FactionKey; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" overflow="visible" aria-hidden="true"><TreatShape faction={faction} /></svg>;
}

export function CastleArt() {
  return (
    <svg width="76" height="58" viewBox="0 0 44 34" overflow="visible" stroke={CHOC} strokeWidth="1.2" strokeLinejoin="round" aria-hidden="true" className="sl-castle-art">
      <path d="M4 33V13h6v4h5v-6h4v-6l3-3 3 3v6h4v6h5v-4h6v20z" fill="#ff9ec0" /><path d="M4 16c2 2 4 2 6 0 2 2 3 2 5 1M29 17c2 1 3 1 5-1 2 2 4 2 6 0M18 9c1.4 1.5 2.6 1.5 4 0 1.4 1.5 2.6 1.5 4 0" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" /><path d="M18 33v-8a4 4 0 0 1 8 0v8" fill="#7a4520" /><path d="M22 2.2V-3" strokeWidth="1" /><path d="M22 -3l5 1.4-5 1.4z" fill="#ff004d" strokeWidth=".8" /><circle cx="9" cy="23" r="1.5" fill="#29adff" /><circle cx="35" cy="23" r="1.5" fill="#00e436" /><circle cx="13" cy="28" r="1.3" fill="#ffec27" /><circle cx="31" cy="28" r="1.3" fill="#ff004d" />
    </svg>
  );
}

export function Signpost() {
  return (
    <svg width="17" height="19" viewBox="0 0 22 24" stroke={CHOC} strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 4h2.2v19H10z" fill="#7a4520" /><path d="M3 4.5h13l3.2 2.6L16 9.7H3z" fill="#ffd6e6" /><path d="M19 11H6l-3.2 2.6L6 16.2h13z" fill="#e9b07a" /><circle cx="11.1" cy="2.6" r="1.8" fill="#ff004d" />
    </svg>
  );
}

export function SugarCube({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1l4.5 2.3v5.4L6 11 1.5 8.7V3.3z" fill="#ffffff" stroke={CHOC} strokeWidth="1" /><path d="M1.5 3.3L6 5.6l4.5-2.3M6 5.6V11" fill="none" stroke={CHOC} strokeWidth=".8" />
    </svg>
  );
}

/** The chocolate arrow on a road space, turned toward the castle. */
export function RoadArrow({ deg }: { deg: number }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke={CHOC} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sl-road-arrow" style={{ transform: `rotate(${deg}deg)` }}>
      <path d="M5 15h19M18 9l6 6-6 6" />
    </svg>
  );
}

/** A small arrow for the side labels, turned explicitly (vertical text does not turn pictures). */
export function TravelArrow({ deg }: { deg: number }) {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ transform: `rotate(${deg}deg)`, flex: 'none' }}>
      <path d="M1 6h15M12 2l4 4-4 4" />
    </svg>
  );
}
