// The Neither Guts nor Gears rulebook: the rules laid out as a printed
// rulebook would be, in the table's own look (colours, type, tile and faction
// inks and icons from the Universe screen). Every word and number comes from
// the game's reference data (the rules half's rulebook.ts, catalogues, maps
// and victory numbers); this file only draws them. A player-count picker
// changes every number and the map that depends on it.

import { useState, type ReactNode } from 'react';
import type { GameReferenceResponse } from '@zekel/wire-types';
import { Cost, FactionChip, Icon, Res, Token } from '../ui.js';
import { RESOURCES, TERRAIN, TREATY_INK } from '../ink.js';
import { atLayout, layoutFor, readRulebook, type Figure, type RulebookData, type Tile, type Unit } from './read.js';
import './rulebook.css';

export interface NggRulebookProps {
  reference: GameReferenceResponse | null;
  /** The player count the page opens on. Default 4. */
  players?: number;
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6];
const LAYOUT_NAME = { '2p': 'two-player layout', '3-4p': 'three-to-four-player layout', '5-6p': 'five-to-six-player layout' } as const;
/** A side's token colour in the examples: a wizard's and a robot's. */
const SIDE_FACTION: Record<string, string> = { wizard: 'The Covenant', robot: 'The Foundry' };

export function NggRulebook({ reference, players = 4 }: NggRulebookProps) {
  const [n, setN] = useState(players);
  const data = readRulebook(reference?.referenceData);
  if (!data) return null;
  const t = data.text;
  const layout = layoutFor(data, n);
  const tiles = data.maps[layout];
  const count = (resource: string) => tiles.filter((x) => x.resource === resource).length;
  const kills = data.victory.kills[n] ?? 0;

  return (
    <div className="ngg-rulebook">
      <header className="ngr-cover">
        <div className="ngr-kicker">Rulebook</div>
        <h1>{t.title}</h1>
        <div className="ngr-wrap">
          {[...new Set([t.setup.wizard.factions, t.setup.robot.factions].flatMap((f) => f.split(' · ')))].map((f) => (
            <span key={f} className="ngr-pill"><FactionChip faction={f} size={20} />{f}</span>
          ))}
        </div>
        <div className="ngr-wrap">{t.facts.map((f) => <span key={f} className="ngr-pill">{f}</span>)}</div>
        <p>{t.intro}</p>
      </header>

      <div className="ngr-countbar" role="group" aria-label="Number of players">
        <span className="ngr-kicker">Players</span>
        <div className="ngr-seg">
          {PLAYER_COUNTS.map((c) => (
            <button key={c} type="button" aria-pressed={c === n} onClick={() => setN(c)}>{c}</button>
          ))}
        </div>
        <span className="ngr-note">{n} players · {LAYOUT_NAME[layout]}</span>
      </div>

      <section aria-labelledby="ngr-win">
        <div className="ngr-kicker">1 · How you win</div>
        <h2 id="ngr-win">Four ways to win</h2>
        <div className="ngr-panel">
          <p className="ngr-rule">{t.victory.intro}</p>
          <div className="ngr-paths">
            <Path title="Military" num={kills} unit={kills === 1 ? 'Leader' : 'Leaders'} text={t.victory.military} />
            <Path title="Cultural" num={data.victory.cultureTarget[n] ?? 0} unit="culture" text={t.victory.cultural} />
            <Path title="Economic" num={data.victory.economicCollectors[layout]} unit="collectors" text={t.victory.economic}>
              <span className="ngr-cost">{Object.entries(t.victory.economic_mix).map(([k, v]) => <Res key={k} resource={k} n={v} />)}</span>
            </Path>
            <Path title="Technological" num={data.victory.tech} unit="points" text={t.victory.technological} />
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-box">
        <div className="ngr-kicker">2 · What's in the box</div>
        <h2 id="ngr-box">Components</h2>
        <div className="ngr-panel">
          <div className="ngr-comp">
            {t.components.map((c) => (
              <div key={c.name}>
                <span className="ngr-mark">{c.icon.startsWith('The ') ? <FactionChip faction={c.icon} size={22} /> : <Icon name={c.icon} />}</span>
                <span className="ngr-body"><span className="ngr-t">{c.name}</span><span className="ngr-d">{atLayout(c.text, layout)}</span></span>
                <span className="ngr-n">{atLayout(c.count, layout)}</span>
              </div>
            ))}
          </div>
          <div className="ngr-figcap">Counts that depend on the player count follow the picker above.</div>
        </div>
        <div className="ngr-panel">
          <h3>Battle strategy deck · {data.deck.reduce((a, c) => a + c.copies, 0)} cards</h3>
          <div className="ngr-cards">
            <span className="ngr-card-back" aria-label="Card back">✦</span>
            {data.deck.map((c, i) => (
              <div key={i} className="ngr-card">
                <span className="ngr-card-type">Battle card</span>
                <span className="ngr-card-name">{c.kind}</span>
                <span className="ngr-card-effect">{c.effect}</span>
                <span className="ngr-card-count">{c.copies} of {data.deck.reduce((a, x) => a + x.copies, 0)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-map">
        <div className="ngr-kicker">3 · The map</div>
        <h2 id="ngr-map">The board</h2>
        <div className="ngr-panel">
          <p className="ngr-rule">{t.map.intro}</p>
          <div className="ngr-wrap">{RESOURCES.map((r) => <Res key={r} resource={r} />)}</div>
          <div className="ngr-board ngr-scroll"><Board tiles={tiles} letters label={`The ${LAYOUT_NAME[layout]}`} /></div>
          <div className="ngr-wrap">
            <span className="ngr-tagchip">{tiles.length} tiles</span>
            {RESOURCES.map((r) => <span key={r} className="ngr-tagchip">{count(r)} {r}</span>)}
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-setup">
        <div className="ngr-kicker">4 · Setup</div>
        <h2 id="ngr-setup">Setting up</h2>
        <div className="ngr-panel"><ol className="ngr-steps">{t.setup.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></div>
        <div className="ngr-two">
          {(['wizard', 'robot'] as const).map((side) => {
            const s = t.setup[side];
            return (
              <div key={side} className={`ngr-panel ngr-seat-${side}`}>
                <div className="ngr-side-head"><FactionChip faction={s.faction} size={42} /><span><b>{side === 'wizard' ? 'Wizards' : 'Robots'}</b><i>{s.factions}</i></span></div>
                <div className="ngr-wrap ngr-pieces">
                  {s.pieces.map((p) => (
                    <span key={p.name} className="ngr-piece">
                      {Array.from({ length: p.count }, (_, i) => <Token key={i} faction={s.faction} icon={p.icon} name={p.name} size={p.icon === 'Core' ? 20 : 24} />)}
                      <span>{p.count > 1 ? `${p.count} ${p.name}` : p.name}</span>
                    </span>
                  ))}
                </div>
                <p className="ngr-rule">{s.note}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="ngr-round">
        <div className="ngr-kicker">5 · A round</div>
        <h2 id="ngr-round">The six steps of a round</h2>
        <div className="ngr-panel">
          <ol className="ngr-phases">
            {t.round.steps.map((s, i) => (
              <li key={s.name} className="ngr-phase"><div className="ngr-pn"><Icon name={s.icon} size={15} />{s.name}<i>{i + 1}</i></div><p>{s.text}</p></li>
            ))}
          </ol>
          <div className="ngr-figcap">{t.round.note}</div>
        </div>
        <div className="ngr-panel ngr-two">
          <div className="ngr-example">
            <h3>{t.round.stack.title}</h3>
            <p className="ngr-rule">{t.round.stack.intro}</p>
            <ol>{t.round.stack.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
          <div>
            <div className="ngr-kicker">Action stack</div>
            <ul className="ngr-stack" aria-label="The action stack, top card first">
              {t.round.stack.cards.map((c, i) => (
                <li key={i} className={i === 0 ? 'now' : undefined}>
                  <FactionChip faction={c.faction} size={20} /><Icon name={c.action} size={14} />
                  <span className="ngr-stack-name">{c.action}</span><span className="ngr-placed">placed {c.placed}</span>
                  <span className="ngr-ord">{i === 0 ? 'NOW' : `#${i + 1}`}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="ngr-panel">
          <h3>Milestone heroes</h3>
          <p className="ngr-rule">{t.round.milestones.intro}</p>
          <div className="ngr-scroll">
            <table>
              <thead><tr><th>Players</th><th className="c">To win</th>{['1st', '2nd', '3rd', '4th', '5th'].map((h) => <th key={h} className="c">{h}</th>)}</tr></thead>
              <tbody>
                {PLAYER_COUNTS.map((c) => (
                  <tr key={c} className={c === n ? 'here' : undefined}>
                    <td className="n">{c}</td><td className="n">{data.victory.cultureTarget[c]}</td>
                    {(data.victory.milestones[c] ?? []).map((m, i) => <td key={i} className="n">{m}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-pay">
        <div className="ngr-kicker">6 · Paying with collectors</div>
        <h2 id="ngr-pay">{t.paying.title}</h2>
        <div className="ngr-panel ngr-two">
          <figure className="ngr-board">
            <Board tiles={t.paying.example.figure.tiles.map((x) => ({ ...x, start: null }))} pieces={t.paying.example.figure.pieces} label={t.paying.example.figure.caption} />
            <figcaption className="ngr-figcap">{t.paying.example.figure.caption}</figcaption>
          </figure>
          <div className="ngr-example">
            <p className="ngr-rule">{t.paying.intro}</p>
            <h3>{t.paying.example.title} <BuysCost data={data} name={t.paying.example.buys} /></h3>
            <ol>{t.paying.example.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-battle">
        <div className="ngr-kicker">7 · Battle</div>
        <h2 id="ngr-battle">{t.battle.title}</h2>
        <div className="ngr-panel ngr-two">
          <div>
            <div className="ngr-kicker">{t.battle.ladder_title}</div>
            <div className="ngr-ladder">
              {data.ladder.map((u) => (
                <div key={u.name} className={`ngr-rung${t.battle.example.units.includes(u.name) ? ' acting' : ''}`}>
                  <span className="ngr-v">{u.init}</span>
                  <Token faction={SIDE_FACTION[u.species] ?? 'The Foundry'} icon={u.name.endsWith('(hero)') ? 'Hero' : u.name} name={u.name} size={22} />
                  <span className="ngr-nm">{u.name}</span><span className="ngr-st">DMG {u.dmg} · DEF {u.def}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ngr-example">
            <p className="ngr-rule">{t.battle.intro}</p>
            <h3>{t.battle.example.title}</h3>
            <ol>{t.battle.example.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-treaties">
        <div className="ngr-kicker">8 · Treaties</div>
        <h2 id="ngr-treaties">Treaties</h2>
        <div className="ngr-panel">
          <p className="ngr-rule">{t.treaties.intro}</p>
          <div className="ngr-scroll">
            <table>
              <thead><tr><th>Treaty</th><th className="c">Allies in battle</th><th className="c">Collect on their tiles</th><th className="c">Share hands</th><th className="c">Share a win</th><th className="c">Culture / round</th><th>Can be broken</th></tr></thead>
              <tbody>
                {t.treaties.chart.map((row) => {
                  const def = data.treaties.find((x) => x.name === row.treaty);
                  return (
                    <tr key={row.treaty}>
                      <td><span className="ngr-unit-name"><span className="ngr-chip" style={{ width: 24, height: 24, background: TREATY_INK[row.treaty] ?? '#6f6858', color: '#fff' }}><Icon name={row.treaty} size={15} stroke={2.2} /></span>{row.treaty}</span></td>
                      {[row.allies, row.collection, row.hands, row.victory].map((y, i) => <td key={i} className="c">{y ? <span className="ngr-yes" aria-label="yes">✓</span> : <span className="ngr-no" aria-label="no">—</span>}</td>)}
                      <td className="n">+{def?.culture ?? '?'}</td>
                      <td>{def?.breaking ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section aria-labelledby="ngr-units">
        <div className="ngr-kicker">9 · Unit reference</div>
        <h2 id="ngr-units">Units</h2>
        <UnitTable side="wizard" title="Wizard units" units={data.wizardUnits} />
        <UnitTable side="robot" title="Robot units" units={data.robotUnits} note={t.units.note} />
      </section>
    </div>
  );
}

function Path({ title, num, unit, text, children }: { title: string; num: number; unit: string; text: string; children?: ReactNode }) {
  return (
    <div className="ngr-path">
      <h3>{title}</h3>
      <div className="ngr-num">{num}<small>{unit}</small></div>
      <p>{text}</p>
      {children}
    </div>
  );
}

function BuysCost({ data, name }: { data: RulebookData; name: string }) {
  const u = [...data.wizardUnits, ...data.robotUnits].find((x) => x.name === name);
  return u ? <Cost cost={u.cost} /> : null;
}

function UnitTable({ side, title, units, note }: { side: 'wizard' | 'robot'; title: string; units: Unit[]; note?: string }) {
  return (
    <div className={`ngr-panel ngr-seat-${side}`}>
      <div className="ngr-side-head"><FactionChip faction={SIDE_FACTION[side]!} size={28} /><b>{title}</b></div>
      <div className="ngr-scroll">
        <table>
          <thead><tr><th>Unit</th><th>Cost</th><th className="c">Stats</th><th>Notes</th></tr></thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.name}>
                <td><span className="ngr-unit-name"><span className="ngr-unit-mark"><Icon name={u.name} /></span>{u.name}</span></td>
                <td><Cost cost={u.cost} /></td>
                <td>{u.init === null ? <span className="ngr-no">—</span> : (
                  <span className="ngr-statline"><span><i>INIT</i>{u.init}</span><span><i>DMG</i>{u.dmg ?? '—'}</span><span><i>DEF</i>{u.def ?? '—'}</span></span>
                )}</td>
                <td>{u.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="ngr-rule">{note}</p>}
    </div>
  );
}

// The table's hex: 104 x 90, flat-topped, columns 78 apart, doubled rows 45
// apart (zekel-universe glue/ngg/HexMap.tsx).
const HEXW = 104, HEXH = 90, COLW = 78, ROWH = 45;
const HEX_POINTS = [[-52, 0], [-26, -45], [26, -45], [52, 0], [26, 45], [-26, 45]];

function Board({ tiles, pieces = [], letters = false, label }: { tiles: Tile[]; pieces?: Figure['pieces']; letters?: boolean; label: string }) {
  if (!tiles.length) return null;
  const cs = tiles.map((x) => x.c), rs = tiles.map((x) => x.r);
  const cMin = Math.min(...cs), rMin = Math.min(...rs);
  const top = letters ? 26 : 6;
  const X = (c: number) => (c - cMin) * COLW + HEXW / 2 + 6;
  const Y = (r: number) => (r - rMin) * ROWH + HEXH / 2 + top;
  const W = (Math.max(...cs) - cMin) * COLW + HEXW + 12;
  const H = (Math.max(...rs) - rMin) * ROWH + HEXH + top + 6;
  // Column letters are the tiles' own: the label's letters, from any tile in the column.
  const columns = [...new Set(cs)].map((c) => ({ c, letter: tiles.find((x) => x.c === c)!.label.replace(/\d+$/, '') }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {letters && columns.map(({ c, letter }) => <text key={c} className="ngr-col" x={X(c)} y={14} textAnchor="middle">{letter}</text>)}
      {tiles.map((tile) => {
        const x = X(tile.c), y = Y(tile.r), ter = TERRAIN[tile.resource];
        return (
          <g key={tile.label}>
            <title>{[tile.label, ter?.name, tile.start ? `starting location ${tile.start}` : null].filter(Boolean).join(' · ')}</title>
            <polygon points={HEX_POINTS.map(([dx, dy]) => `${x + dx!},${y + dy!}`).join(' ')} fill={ter?.tile ?? '#8d8577'} />
            <text className="ngr-hex-code" x={x} y={y - 29} textAnchor="middle">{tile.label}</text>
            {ter && <g transform={`translate(${x - 6.5},${y + 25})`} className="ngr-hex-glyph"><Icon name={ter.icon} size={13} stroke={2.2} /></g>}
            {tile.start !== null && <><circle className="ngr-start-ring" cx={x} cy={y} r={15} /><text className="ngr-start-num" x={x} y={y + 5} textAnchor="middle">{tile.start}</text></>}
          </g>
        );
      })}
      {pieces.map((p, i) => (
        <foreignObject key={i} x={X(p.c) - 15} y={Y(p.r) - 15} width={30} height={30}>
          <div className="ngr-fo"><Token faction={p.faction} icon={p.icon} name={p.name} dashed={!p.placed} size={28} /></div>
        </foreignObject>
      ))}
    </svg>
  );
}
