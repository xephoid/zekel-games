// The tech tree: one species' buildings, and what each one opens, laid out as
// the canvas's "Wizard Tech Tree" and "Robot Tech Tree" boards draw them. The
// base sits at the root; a trunk runs down a column of buildings; beside each
// building, a row of the units, research and abilities it opens. Everything
// on it is read from the engine's catalogue (what a unit requires, what a
// research needs, what unlocks treaties and battle cards), so the tree follows
// the rules without holding a copy of them. A seat's own types are ticked.

import type { ReactNode } from 'react';
import type { ScreenCtx } from './ctx.js';
import type { NggPlayer } from './read.js';
import type { Cost, RefBuilding, RefResearch, RefUnit } from './ref.js';
import { BattleCardPrice, CostChips, Icon } from './ui.js';

type Kind = 'unit' | 'research' | 'ability';

interface Tile {
  kind: Kind;
  name: string;
  icon: string;
  cost: Cost | null;
  either?: string[];
  body: string;
  have: boolean;
  /** kinds folded into one tile, each with its own price (a robot's collectors) */
  kinds?: Array<{ name: string; cost: Cost }>;
}

interface Row {
  key: string;
  /** null for the rows that need no building */
  building: RefBuilding | null;
  label: string;
  sub: string;
  tiles: Tile[];
}

/** A short line: the first sentence of a longer printed text. */
function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(text.trim());
  return m ? m[1]! : text.trim();
}

/** A unit's line: its battle stats, or else the first sentence of its notes
 *  that says more than the building its row already names. */
function unitBody(u: RefUnit): string {
  const stats = [u.init !== null ? `Init ${u.init}` : null, u.dmg !== null ? `Dmg ${u.dmg}` : null, u.def !== null ? `Def ${u.def}` : null].filter(Boolean).join(' · ');
  if (stats) return stats;
  const sentences = u.notes.split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.find((x) => !/^requires\b/i.test(x)) ?? sentences[0] ?? '';
}

/** The rows of a species' tree, from the catalogue. */
export function treeRows(ctx: ScreenCtx, species: string, player: NggPlayer | null): { base: RefBuilding | null; rows: Row[] } {
  const ref = ctx.ref;
  const buildings = (ref?.buildings ?? []).filter((b) => b.species === species);
  const units = (ref?.units ?? []).filter((u) => u.species === species);
  const research = (ref?.research ?? []).filter((r) => r.species === species);
  const base = buildings.find((b) => b.isBase) ?? null;
  const owned = new Set((player?.tech.acquiredTypeNames ?? []).map((n) => n.toLowerCase()));
  const has = (name: string) => owned.has(name.toLowerCase());
  const built = (b: RefBuilding) => (player?.buildingCounts[b.id] ?? 0) > 0 || has(b.name);

  const unitTile = (u: RefUnit): Tile => ({ kind: 'unit', name: u.name, icon: u.name, cost: u.cost, body: unitBody(u), have: has(u.name) });
  const researchTile = (r: RefResearch): Tile => ({
    kind: 'research', name: r.name, icon: r.name, cost: r.cost, either: r.either.length ? r.either : undefined,
    body: firstSentence(r.effect), have: has(r.name) || (player?.research ?? []).includes(r.id),
  });

  // A robot's typed collectors are one kind per resource: one tile, as the
  // canvas draws them, each kind with its own price.
  const typed = units.filter((u) => u.collector && u.collectorResource);
  const collectorsTile = (): Tile => ({
    kind: 'unit', name: `Collectors ×${typed.length}`, icon: 'Collector', cost: null, body: 'One kind per resource.',
    have: typed.some((u) => has(u.name)), kinds: typed.map((u) => ({ name: u.name.replace(/ collector$/i, ''), cost: u.cost })),
  });

  const rows: Row[] = [];
  const startUnits = units.filter((u) => !u.requiresBuilding);
  if (startUnits.length) {
    const tiles: Tile[] = [];
    for (const u of startUnits) {
      if (typed.includes(u)) { if (u === typed[0]) tiles.push(collectorsTile()); continue; }
      tiles.push(unitTile(u));
    }
    rows.push({ key: 'start', building: null, label: 'Ready from the start', sub: 'No building needed', tiles });
  }
  const atBase = base ? research.filter((r) => r.prerequisite === base.name) : [];
  if (base && atBase.length) rows.push({ key: 'base-research', building: null, label: `Researched at ${base.name}`, sub: 'No building needed', tiles: atBase.map(researchTile) });

  const cards = ref?.battleCardPurchase ?? null;
  for (const b of buildings.filter((x) => !x.isBase)) {
    const tiles: Tile[] = [
      ...units.filter((u) => u.requiresBuilding === b.name).map(unitTile),
      ...research.filter((r) => r.prerequisite === b.name).map(researchTile),
    ];
    // Abilities: what the catalogue says this building unlocks beyond units
    // and research; a building that opens nothing else shows its own effect.
    if (ref?.treatyUnlockedBy[species] === b.name) {
      tiles.push({ kind: 'ability', name: 'Treaties', icon: 'Offer a treaty', cost: null, body: 'Offer and form treaties with other players.', have: built(b) });
    }
    if (cards?.unlockedBy[species] === b.name) {
      // The first card bought (or gained from Archmage Chaimidious) earns the
      // battle strategy card type, one of the tech target's types (ruling #129).
      tiles.push({ kind: 'ability', name: 'Battle strategy cards', icon: 'Battle card', cost: cards.cost, either: cards.either, body: 'Bought on a Research action. The first one is a tech type.', have: has('Battle strategy card') });
    }
    if (tiles.length === 0) {
      tiles.push({ kind: 'ability', name: firstSentence(b.effect).replace(/\.$/, ''), icon: b.name, cost: null, body: b.repeatableMax ? `Build up to ${b.repeatableMax}.` : 'From the building itself.', have: built(b) });
    }
    rows.push({ key: b.id, building: b, label: b.name, sub: '', tiles });
  }
  return { base, rows };
}

function Price({ cost, either }: { cost: Cost | null; either?: string[] }): ReactNode {
  if (!cost) return <span className="ngg-tree-free">No further cost</span>;
  return either ? <BattleCardPrice cost={cost} either={either} /> : <CostChips cost={cost} />;
}

export function TechTree({ ctx, species, player, onClose }: {
  ctx: ScreenCtx;
  species: string;
  /** the seat whose types are ticked; null to show the bare tree */
  player: NggPlayer | null;
  onClose: () => void;
}) {
  const ref = ctx.ref;
  const { base, rows } = treeRows(ctx, species, player);
  const count = (list: Array<{ species: string }> | undefined) => (list ?? []).filter((x) => x.species === species).length;
  const target = ref?.techTarget[species] ?? player?.tech.target ?? null;
  const title = species === 'robot' ? 'The robot tree' : 'The wizard tree';
  const whose = player ? (player.id === ctx.me ? 'A tick marks what you have.' : `A tick marks what ${ctx.seat(player.id)} has.`) : '';
  const baseBuilt = !!(player && base && (player.buildingCounts[base.id] ?? 0) > 0);
  return (
    <div className="sheet-backdrop ngg-tree-backdrop" role="presentation" onClick={onClose}>
      <div className={`sheet ngg-board-sheet ngg-tree-sheet seat-${species}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn secondary small close" onClick={onClose} aria-label="Close the tech tree">✕</button>
        <span className="ngg-ground" aria-hidden="true" />
        <header className="ngg-tree-head">
          <div>
            <h2>{title}</h2>
            <p>Begin at your {base?.name ?? 'base'}. Raise a building and it opens the units, research and abilities beside it. {whose}</p>
          </div>
          <div className="ngg-tree-counts">
            <span><i>Buildings</i><b>{count(ref?.buildings)}</b></span>
            <span><i>Units</i><b>{count(ref?.units)}</b></span>
            <span><i>Research</i><b>{count(ref?.research)}</b></span>
            {ref?.battleCardPurchase && <span><i>Battle card</i><b>1</b></span>}
            {target !== null && <span className="hl"><i>Tech target</i><b>{target}</b></span>}
          </div>
        </header>

        <div className="ngg-tree">
          {base && (
            <div className={`ngg-tree-root${baseBuilt ? ' have' : ''}`}>
              <Icon name={base.name} size={30} stroke={1.8} />
              <b>{base.name}</b>
              <i>Start here</i>
              <span className="ngg-tree-root-cost">Free at setup. Another costs <CostChips cost={base.cost} /></span>
            </div>
          )}
          <ol className="ngg-tree-rows">
            {rows.map((row) => {
              const b = row.building;
              const isBuilt = !!(b && player && (player.buildingCounts[b.id] ?? 0) > 0);
              return (
                <li key={row.key} className="ngg-tree-row">
                  {b
                    ? (
                      <div className={`ngg-tree-building${isBuilt ? ' have' : ''}`}>
                        <Icon name={b.name} size={24} stroke={1.8} />
                        <span><b>{b.name}</b><CostChips cost={b.cost} /></span>
                        {isBuilt && <span className="ngg-tree-tick" title="Built">✓</span>}
                      </div>
                    )
                    : <div className="ngg-tree-label"><b>{row.label}</b><i>{row.sub}</i></div>}
                  <div className="ngg-tree-tiles">
                    {row.tiles.map((t) => (
                      <div key={`${t.kind}:${t.name}`} className={`ngg-tree-tile ${t.kind}${t.have ? ' have' : ''}`} title={t.body}>
                        <Icon name={t.icon} size={20} stroke={1.8} />
                        <span>
                          <b>{t.name}</b>
                          {t.kinds
                            ? <span className="ngg-tree-kinds">{t.kinds.map((k) => <span key={k.name}>{k.name} <CostChips cost={k.cost} /></span>)}</span>
                            : <Price cost={t.cost} either={t.either} />}
                          <i>{t.body}</i>
                        </span>
                        {t.have && <span className="ngg-tree-tick" title="Has it">✓</span>}
                      </div>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <footer className="ngg-tree-legend">
          <span className="ngg-tree-key unit">Unit</span>
          <span className="ngg-tree-key research">Research</span>
          <span className="ngg-tree-key ability">Ability</span>
        </footer>
      </div>
    </div>
  );
}
