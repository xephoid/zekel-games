// `travel`: walk to a place, a person's town or the nearest inn in one action,
// hop by hop with the same leaving-node rules as `move`, stopping at the EDGE
// of any place whose occupants would attack you on the way out (bandits,
// skeletons, undead knights, or a mushroom crowd your tail would complete).
// Nothing is skipped: the player decides at every stop. Travelling again goes
// on. Only KNOWN places can be named (player.knownPlaces): towns always, a
// temple or clearing once the player has stood somewhere a path leads to it. With `via_inn` (not advertised) and the shuckles, the route may pay for
// an inn cart between towns when that is shorter than walking.

import { ENEMY_BY_ID } from '../data/enemies.js';
import { INN_RIDE_COST } from '../data/progression.js';
import type { DemonHunterState, MajorNode } from '../types.js';
import { hopDistances, neighborsOf } from '../world/graph.js';
import { refuse } from './errors.js';
import { whatIsHere } from './describe.js';
import { enemiesAt, hereNode, knowsPlace, personOf } from './helpers.js';
import { arriveInTown, leaveInterior, move, requireNoCombat } from './movement.js';

export interface TravelRequest {
  to?: string;
  person?: string;
  nearest?: 'inn' | 'town';
  via_inn?: boolean;
}

function findNode(state: DemonHunterState, name: string): MajorNode | null {
  const n = name.toLowerCase();
  const nodes = Object.values(state.graph.nodes);
  return nodes.find((x) => x.id.toLowerCase() === n) ?? nodes.find((x) => x.name.toLowerCase() === n) ?? nodes.find((x) => x.name.toLowerCase().replace(/^the /, '') === n.replace(/^the /, '')) ?? null;
}

function townNodeOfPerson(state: DemonHunterState, personId: string): MajorNode {
  const person = personOf(state, personId);
  return state.graph.nodes[state.towns.find((t) => t.id === person.attributes.townId)!.nodeId]!;
}

/** Shortest open path (walled edges excluded), excluding `from`. */
function pathBetween(state: DemonHunterState, from: string, to: string): string[] | null {
  if (from === to) return [];
  const prev: Record<string, string> = {};
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of neighborsOf(state.graph, cur)) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev[n] = cur;
      if (n === to) {
        const path: string[] = [];
        let step: string = n;
        while (step !== from) {
          path.unshift(step);
          step = prev[step]!;
        }
        return path;
      }
      queue.push(n);
    }
  }
  return null;
}

/** What at `nodeId` would attack the player on the way out of it. */
function dangerAt(state: DemonHunterState, nodeId: string, tail: number): string[] {
  const p = state.player;
  const names: string[] = [];
  for (const e of enemiesAt(state, nodeId)) {
    const d = ENEMY_BY_ID[e.type];
    if (p.flying) {
      if (d.behaviour === 'hunter' && d.range >= 3) names.push(d.name);
    } else if (d.behaviour === 'blocker' || d.behaviour === 'hunter') names.push(d.name);
  }
  const mushrooms = enemiesAt(state, nodeId).filter((e) => e.type === 'mushroom').length;
  if (!p.flying && mushrooms + tail >= 5 && mushrooms + tail > 0) names.push(`a crowd of ${mushrooms + tail} Mushrooms (${mushrooms} there, ${tail} following you)`);
  return names;
}

function describeDanger(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return Array.from(counts, ([n, c]) => (c > 1 ? `${c} ${n}s` : n.startsWith('a crowd') ? n : `${/^[aeiou]/i.test(n) ? 'an' : 'a'} ${n}`)).join(', ');
}

export function travel(state: DemonHunterState, q: TravelRequest, lines: string[]): void {
  requireNoCombat(state);
  if (state.dialogue) refuse('Finish the conversation first (say goodbye).');
  if (state.innOpen) refuse('Leave the inn first.');
  const p = state.player;

  // Where to.
  let target: MajorNode;
  if (q.person) target = townNodeOfPerson(state, q.person);
  else if (q.nearest) {
    const dist = hopDistances(state.graph, p.at);
    const towns = Object.values(state.graph.nodes).filter((n) => n.kind === 'town' && dist[n.id] !== undefined && !(p.inside === 'town' && n.id === p.at));
    if (towns.length === 0) refuse('No town is reachable from here.');
    towns.sort((a, b) => dist[a.id]! - dist[b.id]!);
    target = towns[0]!;
    if (p.inside === 'town') refuse(`You are already in ${hereNode(state).name}, which has an inn.`);
  } else if (q.to) {
    // Only places the player knows of: towns always, anything else once
    // they have stood somewhere a path leads to it. An unknown place and a
    // place that does not exist get the same answer, so nothing is given away.
    const n = findNode(state, q.to);
    if (!n || !knowsPlace(state, n.id)) refuse(`You know of no place called "${q.to}" yet. Explore, or ask around; the paths out of every place you reach tell you where they lead.`);
    target = n;
  } else {
    lines.push('Travel where? Name a place, a person (to reach their town), or the nearest inn.');
    return;
  }

  if (p.at === target.id && p.inside !== null) refuse(`You are already in ${target.name}.`);
  if (p.at === target.id) {
    if (target.kind === 'town') {
      arriveInTown(state, target.townId!, lines);
      return;
    }
    refuse(`You are already at ${target.name}.`);
  }

  // Route: walking, or (quietly) a paid cart between towns when it is shorter.
  const walk = pathBetween(state, p.at, target.id);
  if (!walk) refuse(`No path leads to ${target.name} from here${state.graph.edges.some((e) => e.walled) ? ' (a ring of stone wall may be in the way)' : ''}.`);
  let plan: { legs: string[]; ride: { from: string; to: string } | null } = { legs: walk, ride: null };
  if (q.via_inn && p.shuckles >= INN_RIDE_COST) {
    const dist = hopDistances(state.graph, p.at);
    const towns = Object.values(state.graph.nodes).filter((n) => n.kind === 'town');
    const here = hereNode(state);
    const starts = here.kind === 'town' ? [here] : towns.filter((n) => dist[n.id] !== undefined);
    let best: { cost: number; from: MajorNode; to: MajorNode } | null = null;
    for (const a of starts) {
      const fromTarget = hopDistances(state.graph, target.id);
      for (const b of towns) {
        if (b.id === a.id || fromTarget[b.id] === undefined) continue;
        const cost = (dist[a.id] ?? Number.POSITIVE_INFINITY) + fromTarget[b.id]!;
        if (!best || cost < best.cost) best = { cost, from: a, to: b };
      }
    }
    if (best && best.cost < walk.length) {
      plan = { legs: pathBetween(state, p.at, best.from.id)!, ride: { from: best.from.id, to: best.to.id } };
    }
  }

  // Step outdoors first (the wild resets, as always when you leave), unless
  // the cart leaves from the very town you are standing in.
  const cartFromHere = plan.ride !== null && plan.ride.from === p.at && p.inside === 'town';
  if (p.inside !== null && !cartFromHere) leaveInterior(state, lines);

  const stepsBefore = plan.legs.length;
  lines.push(`You set out for ${target.name}${plan.ride ? ` by way of a cart from ${state.graph.nodes[plan.ride.from]!.name}` : ''}.`);

  // Walk the first (or only) stretch.
  const walkTo = plan.ride ? plan.ride.from : target.id;
  if (!walkLegs(state, plan.legs, walkTo, lines)) return;

  if (plan.ride) {
    const from = state.graph.nodes[plan.ride.from]!;
    const to = state.graph.nodes[plan.ride.to]!;
    if (p.inside !== 'town') arriveInTown(state, from.townId!, lines);
    p.shuckles -= INN_RIDE_COST;
    lines.push(`At the ${from.name} inn you pay ${INN_RIDE_COST} shuckles for a cart to ${to.name} (${p.shuckles} left).`);
    arriveInTown(state, to.townId!, lines);
    if (p.at === target.id) return;
    leaveInterior(state, lines);
    const rest = pathBetween(state, p.at, target.id);
    if (!rest) refuse(`No path leads on to ${target.name} from ${to.name}.`);
    if (!walkLegs(state, rest, target.id, lines)) return;
  }
  void stepsBefore;
}

/** Walk `legs` to `finalId`; false if the walk stopped short (edge of danger or a fight). */
function walkLegs(state: DemonHunterState, legs: string[], finalId: string, lines: string[]): boolean {
  const p = state.player;
  // Travelling again from the spot of the last edge stop, the same way, means "go through".
  const pressOn = p.lastEdgeStop && p.lastEdgeStop.from === p.at && legs[0] === p.lastEdgeStop.next ? p.lastEdgeStop.next : null;
  p.lastEdgeStop = null;
  let walked = 0;
  for (const next of legs) {
    const tail = enemiesAt(state, p.at).filter((e) => e.type === 'mushroom').length;
    if (next !== finalId && next !== pressOn) {
      const danger = dangerAt(state, next, tail);
      if (danger.length > 0) {
        p.lastEdgeStop = { from: p.at, next };
        lines.push(`You stop at the edge of ${state.graph.nodes[next]!.name}: ${describeDanger(danger)} ${danger.length === 1 && !danger[0]!.startsWith('a crowd') ? 'waits' : 'wait'} there and would not let you pass. Travel on to go through, or go another way.`);
        if (walked > 0) lines.push(`You are at ${state.graph.nodes[p.at]!.name}. ${whatIsHere(state)}`);
        return false;
      }
    }
    if (next === pressOn && dangerAt(state, next, tail).length > 0) lines.push(`You press on into ${state.graph.nodes[next]!.name}.`);
    const moved = move(state, next, lines, { quiet: true });
    if (!moved) return false; // a fight on the way out of where you stood
    walked++;
  }
  const node = state.graph.nodes[p.at]!;
  if (p.at === finalId && node.kind === 'town') {
    if (p.inside !== 'town') arriveInTown(state, node.townId!, lines);
  } else if (p.at === finalId) lines.push(`You arrive at ${node.name}. ${whatIsHere(state)}`);
  return true;
}
