// The small parts the rulebook is drawn from, matching the table's own
// (zekel-universe apps/web/src/glue/ngg/ui.tsx): the icon, a faction chip, a
// map token, a resource chip and a cost.

import { ICON_ALIASES, ICON_PATHS } from './icons.gen.js';
import { TERRAIN, inkOf } from './ink.js';

export function hasIcon(name: string): boolean {
  return !!(ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIASES[name] ?? '']);
}

export function Icon({ name, size = 16, stroke = 2 }: { name: string; size?: number; stroke?: number }) {
  const paths = ICON_PATHS[name] ?? ICON_PATHS[ICON_ALIASES[name] ?? ''] ?? [];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ngr-icon">
      {paths.slice(0, 4).map((d, i) => (d ? <path key={i} d={d} /> : null))}
      {paths[4] ? <path d={paths[4]} strokeDasharray="3 2.4" /> : null}
    </svg>
  );
}

/** A faction's chip: its fill with its mark inside. */
export function FactionChip({ faction, size = 22 }: { faction: string; size?: number }) {
  const ink = inkOf(faction);
  return (
    <span className="ngr-chip" title={faction} style={{ width: size, height: size, background: ink.fill, color: ink.on }}>
      <Icon name={faction} size={Math.round(size * 0.62)} stroke={2.2} />
    </span>
  );
}

/** A map token in its owner's colour. Dashed: not on the board yet. */
export function Token({ faction, icon, name, dashed = false, size = 24 }: { faction: string; icon: string; name: string; dashed?: boolean; size?: number }) {
  const ink = inkOf(faction);
  const base = icon === 'Base';
  return (
    <span className={`ngr-token${base ? ' base' : ''}${dashed ? ' dashed' : ''}`} title={name}
      style={{ width: size, height: size, background: ink.fill, color: ink.on }}>
      <Icon name={icon} size={Math.round(size * 0.6)} stroke={2.2} />
    </span>
  );
}

/** One resource, as the build menu prints it; with a number, that many. */
export function Res({ resource, n }: { resource: string; n?: number }) {
  const t = TERRAIN[resource];
  if (!t) return <span className="ngr-res">{resource}</span>;
  return (
    <span className="ngr-res" style={{ background: t.chip }} title={n !== undefined ? `${n} ${t.name.toLowerCase()}` : t.name}>
      <Icon name={t.icon} size={11} stroke={2.4} />{n !== undefined ? n : t.name}
    </span>
  );
}

export function Cost({ cost }: { cost: Record<string, number> }) {
  return <span className="ngr-cost">{Object.entries(cost).map(([k, n]) => <Res key={k} resource={k} n={n} />)}</span>;
}
