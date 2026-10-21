// Plain-words descriptions of where the player is: the `look` move and the
// views share these.

import { ENEMY_BY_ID } from '../data/enemies.js';
import { RESOURCE_NODE } from '../data/resources.js';
import type { DemonHunterState } from '../types.js';
import { edgeBetween, neighborsOf } from '../world/graph.js';
import { condition, enemiesAt, hereNode, resourcesAt, townAtNode } from './helpers.js';

export interface NodeView {
  id: string;
  kind: 'town' | 'clearing' | 'temple';
  name: string;
  paths: { to: string; name: string; kind: string; walled: boolean }[];
  enemies: { type: string; name: string; count: number; ids: string[]; condition: string[] }[];
  resources: { kind: string; name: string; count: number; ids: string[] }[];
}

export function describeNode(state: DemonHunterState, nodeId: string = state.player.at): NodeView {
  const node = state.graph.nodes[nodeId]!;
  const paths = neighborsOf(state.graph, nodeId, { includeWalled: true }).map((n) => ({
    to: n,
    name: state.graph.nodes[n]!.name,
    kind: state.graph.nodes[n]!.kind,
    walled: edgeBetween(state.graph, nodeId, n)!.walled,
  }));
  const enemyGroups = new Map<string, { ids: string[]; condition: string[] }>();
  for (const e of enemiesAt(state, nodeId)) {
    const g = enemyGroups.get(e.type) ?? { ids: [], condition: [] };
    g.ids.push(e.id);
    g.condition.push(condition(e));
    enemyGroups.set(e.type, g);
  }
  const resourceGroups = new Map<string, string[]>();
  for (const r of resourcesAt(state, nodeId)) {
    const g = resourceGroups.get(r.kind) ?? [];
    g.push(r.id);
    resourceGroups.set(r.kind, g);
  }
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    paths,
    enemies: Array.from(enemyGroups, ([type, g]) => ({ type, name: ENEMY_BY_ID[type as keyof typeof ENEMY_BY_ID].name, count: g.ids.length, ids: g.ids, condition: g.condition })),
    resources: Array.from(resourceGroups, ([kind, ids]) => ({ kind, name: RESOURCE_NODE[kind as keyof typeof RESOURCE_NODE].name, count: ids.length, ids })),
  };
}

/** The enemies (by count, with ids) and resources where the player stands:
 *  said on every arrival outdoors, so nobody has to look each time
 *  (designer, 2026-10-21). */
export function whatIsHere(state: DemonHunterState, nodeId: string = state.player.at): string {
  const v = describeNode(state, nodeId);
  const parts: string[] = [];
  if (v.enemies.length === 0) parts.push('No enemies here.');
  else {
    parts.push(
      'Enemies: ' +
        v.enemies
          .map((g) => {
            const def = ENEMY_BY_ID[g.type as keyof typeof ENEMY_BY_ID];
            const hurt = g.condition.filter((c) => c !== 'unhurt').length;
            return `${g.count} ${g.count === 1 ? def.name : def.plural} [${g.ids.join(', ')}]${hurt > 0 ? ` (${hurt} of them hurt)` : ''}`;
          })
          .join('; ') +
        '.',
    );
  }
  if (v.resources.length > 0) {
    parts.push('Resources: ' + v.resources.map((g) => `${g.count} ${g.count === 1 ? g.name : RESOURCE_NODE[g.kind as keyof typeof RESOURCE_NODE].plural} [${g.ids.join(', ')}]`).join('; ') + '.');
  }
  return parts.join(' ');
}

export function lookText(state: DemonHunterState): string {
  const p = state.player;
  const here = hereNode(state);
  if (p.inside === 'town') {
    const town = townAtNode(state, here.id)!;
    const names = town.people.map((x) => `${x.name} the ${x.attributes.occupation}${x.hasMet ? '' : ' (not yet met)'}`);
    return `You are inside ${town.name}. The inn is open. People here: ${names.join('; ')}. Each has a house you could search. Paths lead out of town.`;
  }
  if (p.inside === 'temple') {
    return `You are inside the ${here.name}.`;
  }
  const v = describeNode(state);
  const parts: string[] = [];
  parts.push(`You are at ${v.name} (${v.kind})${p.flying ? ', flying' : ''}${here.kind !== 'clearing' ? `, outside its door` : ''}.`);
  parts.push(
    'Paths: ' +
      v.paths.map((x) => `${x.name} (${x.kind}${x.walled ? ', blocked by a ring of stone wall' : ''})`).join(', ') +
      '.',
  );
  parts.push(whatIsHere(state));
  const followers = p.followers.map((id) => state.towns.flatMap((t) => t.people).find((x) => x.id === id)?.name ?? id);
  if (followers.length > 0) parts.push(`${followers.join(' and ')} ${followers.length === 1 ? 'is' : 'are'} travelling with you.`);
  return parts.join(' ');
}
