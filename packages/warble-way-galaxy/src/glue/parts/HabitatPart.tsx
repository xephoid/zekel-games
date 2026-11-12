// Docked at a habitat (Habitat.dc.html, build item 5): named rows for the
// missions, the shop and the cantina with their stamps, the visit's
// actions on the right, and the overlays for equip, release, tinker and
// fabricate.
//
// Nothing here acts on a first tap. A row or a visit action opens the
// choice panel at the top of the board: what the engine says the move
// leads to (the roll with its chance, what passing and failing do, what
// else it sets off), or why it is shut, and one button that sends the
// listed move. A mission leaves the habitat the moment it is taken, so the
// panel says so before the button is pressed.

import { useEffect, useRef, useState } from 'react';
import type { LegalMove } from '@zekel/glue-kit';
import { asStr } from '@zekel/glue-kit';
import { abilityWords, percent, previewOf, reasonFor, type RollFacts } from '../facts.js';
import { Icon, type IconName } from '../icons.js';
import { moveById, type WwTable } from '../read.js';
import { ActionCard, CrewPanel, GoldButton, Lbl, Num, ShipPanel, Token, scoreLine } from '../ui.js';
import { Chance, RollBrief, partWords } from './Facts.js';
import { RollPanel } from './RollPanel.js';
import type { PartProps } from './SpacePart.js';

type Overlay = 'equip' | 'release' | 'workshop' | null;
type Pick = { kind: 'mission' | 'shop' | 'cantina' | 'visit'; id: string } | null;

const STAMP: Record<string, { word: string; cls: string }> = {
  passed: { word: 'PASSED', cls: 'green' }, failed: { word: 'FAILED', cls: 'red' }, sold: { word: 'SOLD', cls: 'grey' }, marked: { word: 'MARKED', cls: 'red' }, hired: { word: 'ABOARD', cls: 'gold' },
};

const ITEM_ICON = (type: string) => (type === 'weapon' ? 'gun' : type === 'armor' ? 'armor' : type === 'consumable' ? 'drink' : type === 'ship_part' ? 'rocket' : 'tag') as 'gun' | 'armor' | 'drink' | 'rocket' | 'tag';

/** A roll in a few words, for a button's second line: "50% · 3 dice + Mechanics +1, need 12". */
function briefLine(facts: RollFacts, input: PartProps['input']): string {
  const added = facts.parts.map((p) => partWords(p, facts, input)).join(' and ');
  return `${percent(facts.chance)} · ${facts.dice} dice${added ? ` + ${added.replace(/^your /, '')}` : ''}${facts.target !== undefined ? `, need ${facts.target}` : ''}`;
}

interface MainProps extends PartProps { pick: Pick; setPick(p: Pick): void }

export function HabitatMain({ table, input, phone, pick, setPick }: MainProps) {
  const h = table.habitat;
  if (!h) return null;
  const find = (id: string) => moveById(input.legalMoves, id);
  const pips = /complete (\d+) missions \(any result; (\d+) done\)/.exec(h.progression);
  // The being a pending recruit roll is for, so its row stays lit while the dice wait.
  const pctx = table.pending?.kind === 'roll' && typeof table.pending['context'] === 'object' && table.pending['context'] !== null ? (table.pending['context'] as Record<string, unknown>) : null;
  const rollingFor = pctx && asStr(pctx['recruit_source']) === 'cantina' ? asStr(pctx['recruit_id']) : '';
  const sel = (kind: NonNullable<Pick>['kind'], id: string) => pick?.kind === kind && pick.id === id;
  const toggle = (kind: NonNullable<Pick>['kind'], id: string) => setPick(sel(kind, id) ? null : { kind, id });
  return (
    <div className="ww-main-card" style={{ padding: phone ? 14 : '24px 26px' }}>
      <div className="ww-hab-head">
        <div className="ww-row" style={{ gap: 18 }}>
          <span><Icon name="ringed" size={phone ? 40 : 60} /></span>
          <div className="ww-col" style={{ gap: 2 }}>
            <Lbl style={{ color: '#FFD700' }}>HABITAT #{h.number}</Lbl>
            <h1 className="ww-hab-title" style={phone ? { fontSize: 28 } : undefined}>{h.name}</h1>
          </div>
        </div>
        <div className="ww-hab-next">
          <Lbl className="ww-dim">TO NEXT HABITAT</Lbl>
          <span style={{ fontSize: 14, textAlign: 'right' }}>{h.progression.replace(/ \(any result; \d+ done\)/, '')}</span>
          {pips && (
            <span className="ww-pips" aria-label={`${pips[2]} of ${pips[1]} missions done`}>
              {Array.from({ length: Number(pips[1]) }, (_, i) => <span key={i} className={i < Number(pips[2]) ? 'on' : ''} />)}
              <Num style={{ fontSize: 13, marginLeft: 6 }}>{pips[2]} of {pips[1]}</Num>
            </span>
          )}
        </div>
      </div>
      <div className="ww-hab-cols">
        <section className="ww-hab-col" aria-label="Missions">
          <div className="ww-hab-col-head"><Icon name="idcard" size={22} /><span className="ww-h2">Missions</span><span className="ww-dim">ability · need</span></div>
          {h.missions.map((m) => {
            const mid = m.id ?? String(m.index);
            const mv = find(`take-mission-${mid}`);
            const stamp = STAMP[m.status];
            const check = previewOf(mv)?.check;
            return (
              <button key={mid} type="button" className={`ww-mrow${stamp ? ' done' : ''}${sel('mission', mid) ? ' sel' : ''}${!mv && !stamp ? ' idle' : ''}`} style={{ gridTemplateColumns: '46px minmax(0, 1fr) auto' }} disabled={!!stamp} aria-pressed={sel('mission', mid)} onClick={() => toggle('mission', mid)} aria-label={`${m.title}${stamp ? `, ${stamp.word.toLowerCase()}` : mv ? '' : ', not on offer'}`}>
                <span className="ww-mrow-chip"><Lbl style={{ fontSize: 11, letterSpacing: '.08em' }}>{m.ability ?? `R${m.depth}`}</Lbl>{m.depth ? <Icon name="chest" size={14} /> : <Num style={{ fontSize: 14, lineHeight: 1 }}>{m.need}</Num>}</span>
                <span className="ww-mrow-mid"><span className="ww-mrow-name">{m.title}</span><span className="ww-mrow-meta">{m.distance} away · {m.credits.toLocaleString('en-US')}c · {m.xp} XP{m.depth ? ' · a ruin, no roll' : ''}</span>{!mv && !stamp && <span className="ww-mrow-shut">{table.pending ? 'after this roll' : m.ability ? `no one aboard has ${m.ability}` : 'not on offer'}</span>}</span>
                <span className="ww-mrow-end">{stamp ? <span className={`ww-stamp ${stamp.cls}`}>{stamp.word}</span> : check ? <Chance chance={check.chance} /> : null}</span>
              </button>
            );
          })}
        </section>
        <section className="ww-hab-col" aria-label="Shop">
          <div className="ww-hab-col-head"><Icon name="tag" size={22} /><span className="ww-h2">Shop</span><span className="ww-dim">each sells once</span></div>
          {h.shop.map((s) => {
            const mv = s.id ? find(`buy-${s.id}`) : undefined;
            const sold = s.status === 'sold';
            const key = s.id ?? String(s.index);
            return (
              <button key={s.index} type="button" className={`ww-mrow${sold ? ' done' : ''}${sel('shop', key) ? ' sel' : ''}${!mv && !sold ? ' idle' : ''}`} style={{ gridTemplateColumns: '26px minmax(0, 1fr) auto' }} disabled={sold} aria-pressed={sel('shop', key)} onClick={() => toggle('shop', key)} aria-label={`${s.title}, ${s.cost}c${sold ? ', sold' : mv ? '' : ', not on offer'}`}>
                <Icon name={ITEM_ICON(s.type)} size={22} />
                <span className="ww-mrow-mid"><span className="ww-mrow-name">{s.title}</span><span className="ww-mrow-meta">{s.meta || s.name}</span></span>
                <span className="ww-mrow-end"><Num style={{ fontSize: 14 }}>{s.cost.toLocaleString('en-US')}c</Num>{sold && <span className="ww-stamp grey">SOLD</span>}</span>
              </button>
            );
          })}
        </section>
        <section className="ww-hab-col" aria-label="Cantina">
          <div className="ww-hab-col-head"><Icon name="talk" size={22} /><span className="ww-h2">Cantina</span><span className="ww-dim">roll vs need</span></div>
          {h.cantina.map((b) => {
            const mv = b.id ? find(`recruit-${b.id}`) : undefined;
            const stamp = STAMP[b.status];
            const rolling = !!b.id && rollingFor === b.id;
            const key = b.id ?? String(b.index);
            const roll = previewOf(mv)?.roll;
            return (
              <button key={b.index} type="button" className={`ww-mrow${stamp ? ' done' : ''}${sel('cantina', key) ? ' sel' : ''}${rolling ? ' rolling' : !mv && !stamp ? ' idle' : ''}`} style={{ gridTemplateColumns: '38px minmax(0, 1fr) auto' }} disabled={!!stamp || rolling} aria-pressed={sel('cantina', key)} onClick={() => toggle('cantina', key)} aria-label={`${b.title}${stamp ? `, ${stamp.word.toLowerCase()}` : ''}`}>
                <span style={{ opacity: stamp ? .5 : 1 }}><Token race={b.race} size={36} /></span>
                <span className="ww-mrow-mid"><span className="ww-mrow-name">{b.title}</span><span className="ww-mrow-meta">{b.race.charAt(0).toUpperCase() + b.race.slice(1)}{b.idealized ? ` · idealizes ${b.idealized}` : ''}{b.need ? ` · need ${b.need}` : ''}</span></span>
                <span className="ww-mrow-end"><Num style={{ fontSize: 13, textAlign: 'right', lineHeight: 1.25 }}>{b.chips.map((c) => <span key={c} style={{ display: 'block' }}>{c}</span>)}</Num>{stamp ? <span className={`ww-stamp ${stamp.cls}`}>{stamp.word}</span> : roll ? <Chance chance={roll.chance} /> : null}</span>
              </button>
            );
          })}
        </section>
      </div>
    </div>
  );
}

const VISIT: Array<{ id: string; type: string; icon: 'crack' | 'credits' | 'convince' | 'talk'; name: string; confirm: string }> = [
  { id: 'attempt-repair', type: 'attempt_repair', icon: 'crack', name: 'Repair roll', confirm: 'ROLL TO REPAIR' },
  { id: 'pay-repair', type: 'pay_repair', icon: 'credits', name: 'Pay for repair', confirm: 'PAY 150c' },
  { id: 'attempt-reduce-unrest', type: 'attempt_reduce_unrest', icon: 'convince', name: 'Ease unrest', confirm: 'ROLL TO EASE UNREST' },
  { id: 'recruit-unnamed', type: 'recruit_unnamed', icon: 'talk', name: 'Work the docks', confirm: 'WORK THE DOCKS' },
];

/** The second line of a visit action: the roll in brief, the engine's reason it is shut, or that a roll comes first. */
function visitSub(table: WwTable, input: PartProps['input'], id: string, type: string): string {
  const mv = moveById(input.legalMoves, id);
  if (mv) {
    const p = previewOf(mv);
    if (p?.roll) return briefLine(p.roll, input);
    if (id === 'pay-repair') return '150c a step';
    return '';
  }
  if (table.pending) return 'after this roll';
  return reasonFor(input.unavailable, type) ?? 'not on offer';
}

export function VisitPanel(props: PartProps & { overlay: Overlay; setOverlay(o: Overlay): void; pick: Pick; setPick(p: Pick): void }) {
  const { table, input, overlay, setOverlay, pick, setPick } = props;
  const h = table.habitat;
  if (!h) return null;
  const find = (id: string) => moveById(input.legalMoves, id);
  const depart = find('depart');
  const equips = input.legalMoves.filter((m) => m.move['type'] === 'equip_item');
  const releases = input.legalMoves.filter((m) => m.move['type'] === 'release_crew');
  const workshop = input.legalMoves.filter((m) => m.move['type'] === 'upgrade_item' || m.move['type'] === 'fabricate_part');
  const sel = (id: string) => pick?.kind === 'visit' && pick.id === id;
  const departWhy = depart ? null : table.pending ? 'after this roll' : reasonFor(input.unavailable, 'depart_for_next_habitat');
  return (
    <section className="ww-panel" aria-label="This visit">
      <Lbl className="ww-panel-label">THIS VISIT</Lbl>
      {VISIT.map((v) => {
        const mv = find(v.id);
        return (
          <button key={v.id} type="button" className={`ww-visit-btn${mv ? ' open' : ''}${sel(v.id) ? ' sel' : ''}`} aria-pressed={sel(v.id)} aria-disabled={!mv} onClick={() => setPick(sel(v.id) ? null : { kind: 'visit', id: v.id })}>
            <span className="ww-visit-icon"><Icon name={v.icon} size={22} /></span>
            <span className="ww-col" style={{ flex: 1 }}><span style={{ fontWeight: 600 }}>{v.name}</span><span className="ww-dim" style={{ fontSize: 12 }}>{visitSub(table, input, v.id, v.type)}</span></span>
          </button>
        );
      })}
      <div className="ww-visit-small">
        <button type="button" disabled={equips.length === 0} title={equips.length === 0 ? reasonFor(input.unavailable, 'equip_item') ?? undefined : undefined} onClick={() => setOverlay(overlay === 'equip' ? null : 'equip')}>Equip</button>
        <button type="button" disabled={releases.length === 0} title={releases.length === 0 ? reasonFor(input.unavailable, 'release_crew') ?? undefined : undefined} onClick={() => setOverlay(overlay === 'release' ? null : 'release')}>Release</button>
        <button type="button" onClick={() => setOverlay(overlay === 'workshop' ? null : 'workshop')}>{workshop.length ? 'Workshop' : 'Workshop · shut'}</button>
      </div>
      <div className="ww-col" style={{ gap: 10, marginTop: 6 }}>
        <GoldButton quiet={!depart} className={sel('depart') ? 'sel' : undefined} onClick={() => setPick(sel('depart') ? null : { kind: 'visit', id: 'depart' })}>{depart && /FINALE/.test(depart.description ?? '') ? 'ENTER THE FINALE' : `DEPART FOR HABITAT #${h.number + 1}`}</GoldButton>
        <span className="ww-dim" style={{ fontSize: 12, textAlign: 'center' }}>{departWhy ?? h.progression.replace(/ \(any result; (\d+) done\)/, ' ($1 done)')}</span>
      </div>
    </section>
  );
}

/** The choice panel: what the picked row or action leads to, and the one button that sends it. */
export function ChoicePanel(props: PartProps & { pick: Pick; setPick(p: Pick): void }) {
  const { table, input, pressable, onMove, pick, setPick } = props;
  const ref = useRef<HTMLElement | null>(null);
  const sig = pick ? `${pick.kind}:${pick.id}` : '';
  useEffect(() => { if (sig) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [sig]);
  const h = table.habitat;
  if (!pick || !h) return null;
  const find = (id: string) => moveById(input.legalMoves, id);
  let kicker = ''; let title = ''; let lines: string[] = []; let mv: LegalMove | undefined; let confirm = ''; let why: string | null = null;
  let roll: RollFacts | undefined; let rollLabel = ''; let icon: IconName = 'idcard';
  if (pick.kind === 'mission') {
    const m = h.missions.find((x) => x.id === pick.id);
    if (!m) return null;
    mv = find(`take-mission-${m.id}`);
    const p = previewOf(mv);
    kicker = 'MISSION'; title = m.title; icon = m.depth ? 'chest' : 'idcard';
    lines = [`${m.distance} away · pays ${m.credits.toLocaleString('en-US')}c and ${m.xp} XP.${m.depth ? ` A ruin, to depth ${m.depth}: no roll at the far end.` : ''}`, ...(p?.then ? [p.then] : mv && !p ? [mv.description ?? ''] : [])];
    roll = p?.check; rollLabel = 'THE CHECK AT THE FAR END, AS YOUR CREW STANDS NOW';
    confirm = 'TAKE IT AND LEAVE';
    why = mv ? null : table.pending ? 'After this roll.' : reasonFor(input.unavailable, 'take_mission', m.id);
  } else if (pick.kind === 'shop') {
    const s = h.shop.find((x) => (x.id ?? String(x.index)) === pick.id);
    if (!s) return null;
    mv = s.id ? find(`buy-${s.id}`) : undefined;
    const p = previewOf(mv);
    kicker = s.type.replace(/_/g, ' ').toUpperCase(); title = s.title; icon = ITEM_ICON(s.type);
    lines = [p?.then ?? s.meta ?? s.name];
    confirm = `BUY FOR ${s.cost.toLocaleString('en-US')}c`;
    why = mv ? null : table.pending ? 'After this roll.' : (s.id ? reasonFor(input.unavailable, 'buy_item', s.id) : null);
  } else if (pick.kind === 'cantina') {
    const b = h.cantina.find((x) => (x.id ?? String(x.index)) === pick.id);
    if (!b) return null;
    mv = b.id ? find(`recruit-${b.id}`) : undefined;
    const p = previewOf(mv);
    kicker = 'CANTINA'; title = b.title; icon = 'talk';
    const aboard = table.ship ? `${1 + table.crew.length} of ${table.ship.capacity} aboard` : '';
    lines = [`${b.race.charAt(0).toUpperCase() + b.race.slice(1)}. Brings ${b.chips.join(', ') || 'no scores'}.${aboard ? ` ${aboard}.` : ''}`, ...(mv && !p ? [mv.description ?? ''] : [])];
    roll = p?.roll; rollLabel = 'THE RECRUIT ROLL';
    confirm = 'TRY TO RECRUIT';
    why = mv ? null : table.pending ? 'After this roll.' : 'Not on offer.';
  } else {
    const v = VISIT.find((x) => x.id === pick.id);
    mv = find(pick.id);
    const p = previewOf(mv);
    if (pick.id === 'depart') {
      kicker = 'LEAVE'; title = mv && /FINALE/.test(mv.description ?? '') ? 'The finale' : `Depart for habitat #${h.number + 1}`; icon = 'rocket';
      lines = [p?.then ?? mv?.description ?? ''].filter(Boolean);
      confirm = mv && /FINALE/.test(mv.description ?? '') ? 'ENTER THE FINALE' : 'DEPART';
      why = mv ? null : table.pending ? 'After this roll.' : reasonFor(input.unavailable, 'depart_for_next_habitat');
    } else if (v) {
      kicker = 'THIS VISIT'; title = v.name; icon = v.icon;
      lines = [p?.then ?? (mv && !p?.roll ? mv.description ?? '' : '')].filter(Boolean);
      roll = p?.roll; rollLabel = 'THE ROLL';
      confirm = v.confirm;
      why = mv ? null : table.pending ? 'After this roll.' : reasonFor(input.unavailable, v.type);
    } else return null;
  }
  return (
    <section ref={ref} className="ww-choice" aria-label={`${title}: the choice`}>
      <div className="ww-row between" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="ww-row" style={{ gap: 14, alignItems: 'flex-start', minWidth: 0 }}>
          <span style={{ color: '#FFD700', flex: 'none' }}><Icon name={icon} size={34} /></span>
          <div className="ww-col" style={{ gap: 4, minWidth: 0 }}>
            <Lbl style={{ color: '#FFD700' }}>{kicker}</Lbl>
            <span className="ww-h1" style={{ fontSize: 26 }}>{title}</span>
            {lines.map((l) => <span key={l} className="ww-choice-line">{l}</span>)}
          </div>
        </div>
        <button type="button" className="ww-modal-close" aria-label="Close" onClick={() => setPick(null)}>✕</button>
      </div>
      {roll && <RollBrief facts={roll} input={input} label={rollLabel} />}
      {why && <div className="ww-locked"><Lbl>NOT NOW</Lbl><span style={{ flex: 1 }}>{why}</span></div>}
      <div className="ww-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <GoldButton onClick={() => mv && onMove(mv)} disabled={!pressable || !mv}>{confirm}</GoldButton>
        <GoldButton quiet onClick={() => setPick(null)}>NOT NOW</GoldButton>
      </div>
    </section>
  );
}

/** The equip, release and workshop overlays over the habitat. */
export function HabitatOverlay(props: PartProps & { overlay: Overlay; setOverlay(o: Overlay): void }) {
  const { table, input, pressable, onMove, overlay, setOverlay } = props;
  if (!overlay) return null;
  const close = () => setOverlay(null);
  const beings = [table.me, ...table.crew].filter((b): b is NonNullable<typeof b> => !!b);
  const equips = input.legalMoves.filter((m) => m.move['type'] === 'equip_item');
  const releases = input.legalMoves.filter((m) => m.move['type'] === 'release_crew');
  const upgrades = input.legalMoves.filter((m) => m.move['type'] === 'upgrade_item');
  const fabs = input.legalMoves.filter((m) => m.move['type'] === 'fabricate_part');
  const item = (id: string) => table.items.find((i) => i.id === id);
  const itemByName = (name: string) => table.items.find((i) => i.name === name);
  let kicker = ''; let title = ''; let lede = ''; let foot = ''; let body: JSX.Element | null = null;
  if (overlay === 'equip') {
    kicker = 'EQUIP GEAR'; title = 'Who wears what?'; lede = 'Each being wears one weapon and one armor at most. Gear can be changed while docked.';
    const loose = table.items.filter((i) => (i.type === 'weapon' || i.type === 'armor') && !i.wornBy);
    body = (
      <div className="ww-col" style={{ gap: 8 }}>
        {beings.map((b) => (
          <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr) minmax(0, 1fr)', gap: 10, alignItems: 'center' }}>
            <span className="ww-row" style={{ gap: 10 }}><Token race={b.race} size={38} /><span className="ww-col"><span style={{ fontWeight: 600 }}>{b.title}{b.captain ? ' (you)' : ''}</span><Num className="ww-dim" style={{ fontSize: 11 }}>{scoreLine(b) || 'no scores'}</Num></span></span>
            {(['weapon', 'armor'] as const).map((slot) => {
              const worn = b.equipped[slot] ? item(b.equipped[slot]!) : undefined;
              const options = equips.filter((m) => asStr(m.move['being']) === b.name && itemByName(asStr(m.move['item_name']))?.type === slot);
              return (
                <span key={slot} className="ww-col" style={{ gap: 4 }}>
                  <span className={`ww-slot${worn ? ' on' : ''}`} title={worn?.effect}><Icon name={slot === 'weapon' ? 'gun' : 'armor'} size={18} />{worn ? worn.title : `no ${slot}`}</span>
                  {options.map((m) => { const it = itemByName(asStr(m.move['item_name'])); return <button key={m.move_id} type="button" className="ww-slot btn" disabled={!pressable} onClick={() => onMove(m)} title={it?.effect}><Icon name={slot === 'weapon' ? 'gun' : 'armor'} size={18} />put on {it?.title ?? asStr(m.move['item_name'])}</button>; })}
                </span>
              );
            })}
          </div>
        ))}
        {loose.length > 0 && <div className="ww-col" style={{ gap: 6, padding: '12px 14px', borderRadius: 12, border: '1.5px solid #FFD700', background: '#3a3520' }}><Lbl style={{ fontSize: 11, color: '#FFD700' }}>HOLDING, WORN BY NO ONE</Lbl>{loose.map((i) => <span key={i.id} style={{ fontSize: 13 }}><b>{i.title}</b>{i.effect ? ` · ${i.effect}` : ''}</span>)}</div>}
      </div>
    );
  } else if (overlay === 'release') {
    kicker = 'RELEASE CREW'; title = 'Let someone go?'; lede = 'They leave the ship here.';
    body = (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {table.crew.map((c) => {
          const m = releases.find((r) => asStr(r.move['crew_name']) === c.name);
          return (
            <div key={c.name} className="ww-release">
              <Token race={c.race} size={52} />
              <span className="ww-col" style={{ flex: 1 }}><span className="ww-h2" style={{ fontSize: 18 }}>{c.title}</span><span className="ww-dim" style={{ fontSize: 12 }}>{previewOf(m)?.then ?? `${c.race} · anger ${c.anger}`}</span></span>
              <button type="button" className="ww-release-btn" disabled={!pressable || !m} onClick={() => m && onMove(m)}>RELEASE</button>
            </div>
          );
        })}
      </div>
    );
  } else {
    const mec = abilityWords(input.reference, 'MEC');
    kicker = 'THE WORKSHOP'; title = upgrades.length + fabs.length > 0 ? 'The workshop is open' : 'The workshop is shut';
    foot = mec?.advanced ? `${mec.advanced.name}: ${mec.advanced.what}` : '';
    const shut = [...new Set([reasonFor(input.unavailable, 'fabricate_part'), reasonFor(input.unavailable, 'upgrade_item')].filter((x): x is string => !!x))];
    body = (
      <div className="ww-col" style={{ gap: 12 }}>
        {(upgrades.length > 0 || fabs.length > 0) && (
          <div className="ww-acts two">
            {upgrades.map((m) => <ActionCard key={m.move_id} icon="gun" name={`Improve · ${itemByName(asStr(m.move['item_name']))?.title ?? asStr(m.move['item_name'])}`} what={m.description ?? ''} onClick={() => onMove(m)} disabled={!pressable} />)}
            {fabs.map((m) => <ActionCard key={m.move_id} icon="rocket" name={`Build · +1 ${asStr(m.move['stat'])}`} what={m.description ?? ''} onClick={() => onMove(m)} disabled={!pressable} />)}
          </div>
        )}
        {shut.map((s) => <div key={s} className="ww-locked"><Lbl>SHUT</Lbl><span style={{ flex: 1 }}>{s}</span></div>)}
        {shut.length === 0 && upgrades.length + fabs.length === 0 && <div className="ww-locked"><Lbl>SHUT</Lbl><span style={{ flex: 1 }}>{table.pending ? 'After this roll.' : 'Nothing to build or improve right now.'}</span></div>}
      </div>
    );
  }
  return (
    <div className="ww-ov" role="presentation" onClick={close}>
      <div className="ww-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ww-row between" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="ww-col" style={{ gap: 4 }}><Lbl style={{ color: '#FFD700' }}>{kicker}</Lbl><span className="ww-h1" style={{ fontSize: 30 }}>{title}</span>{lede && <span className="ww-lede">{lede}</span>}</div>
          <button type="button" className="ww-modal-close" aria-label="Close" onClick={close}>✕</button>
        </div>
        {body}
        {foot && <span className="ww-dim" style={{ fontSize: 12, lineHeight: 1.5 }}>{foot}</span>}
      </div>
    </div>
  );
}

export function HabitatPart(props: PartProps & { right: (node: JSX.Element) => JSX.Element }) {
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [pick, setPick] = useState<Pick>(null);
  const { table, input } = props;
  // A new event is a new table: what was picked on the old one is put down.
  useEffect(() => { setPick(null); }, [input.seq]);
  return (
    <>
      <div className="ww-main">
        {table.pending?.kind === 'roll' ? <RollPanel {...props} /> : <ChoicePanel {...props} pick={pick} setPick={setPick} />}
        <HabitatMain {...props} pick={pick} setPick={setPick} />
      </div>
      {props.right(
        <>
          <VisitPanel {...props} overlay={overlay} setOverlay={setOverlay} pick={pick} setPick={setPick} />
          <ShipPanel table={table} input={input} compact />
          <CrewPanel table={table} input={input} />
        </>,
      )}
      <HabitatOverlay {...props} overlay={overlay} setOverlay={setOverlay} />
    </>
  );
}
