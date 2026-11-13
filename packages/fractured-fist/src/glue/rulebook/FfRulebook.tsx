// The Fractured Fist rulebook: the rules laid out as a printed rulebook would
// be, in the table's arcade look. Card faces are the table's own (printedCard
// and the theme's card styles in ff.css), and every word, number and card
// comes from the game's reference data (the rules half's rulebook.ts and its
// card list). This file only draws them; it works out no rule.

import type { CSSProperties, ReactNode } from 'react';
import { Card, paletteVars } from '@zekel/primitives';
import type { GameReferenceResponse } from '@zekel/wire-types';
import { PALETTE, printedCard, type CardDef } from '../read.js';
import { readRulebook, type Counters, type Example, type RulebookData, type Side } from './read.js';
import '../ff.css';
import './rulebook.css';

export interface FfRulebookProps {
  reference: GameReferenceResponse | null;
}

/** The counters' names, as the table's action bar prints them. */
const COUNTER_WORDS: Record<keyof Counters, string> = {
  actions: 'Actions', damage: 'Damage', defense: 'Defense', spirit: 'Spirit', channels: 'Buys', refine: 'Refine',
  missteps: 'Missteps', stamina: 'Stamina',
};

export function FfRulebook({ reference }: FfRulebookProps) {
  const data = readRulebook(reference);
  if (!data) return null;
  const t = data.text;
  const face = (id: string, key: string) => <Face data={data} card={id} instance={key} />;

  return (
    <div className="ff-theme ff-rulebook" style={paletteVars(PALETTE) as CSSProperties}>
      <header className="ffr-cover">
        <span className="ff-tag">Rulebook</span>
        <h1>{t.title}</h1>
        <div className="ffr-wrap">{t.facts.map((f) => <span key={f} className="ff-step">{f}</span>)}</div>
        <p className="ffr-lede">{t.intro}</p>
        <div className="ffr-cover-cards ffr-cards-lg" aria-hidden="true">
          {t.setup.loadout.slice(0, 3).map((id, i) => <span key={id} style={{ rotate: `${(i - 1) * 7}deg` }}>{face(id, `cover:${id}`)}</span>)}
        </div>
      </header>

      <Section n={1} id="ffr-win" title={t.win.title}>
        <div className="ffr-panel ffr-win">
          <div className="ffr-meter" aria-hidden="true">
            {Array.from({ length: t.strike.example.you.stamina }, (_, i) => <span key={i} className={i === 0 ? 'gone' : undefined} />)}
          </div>
          <p>{t.win.text}</p>
          <p className="ffr-note">{t.win.tie}</p>
        </div>
      </Section>

      <Section n={2} id="ffr-box" title="What each player needs">
        <div className="ffr-panel">
          <p>{t.components.intro}</p>
          <ul className="ffr-comp">
            {t.components.items.map((c) => (
              <li key={c.name}>
                <span className="ffr-comp-pic">{c.card ? face(c.card, `box:${c.card}`) : <span className="ffr-meter small" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</span>}</span>
                <span className="ffr-comp-body"><b>{c.name}</b><span>{c.text}</span></span>
                <span className="ffr-count">{c.count}</span>
              </li>
            ))}
          </ul>
          <p className="ffr-note">{t.components.note}</p>
        </div>
      </Section>

      <Section n={3} id="ffr-setup" title="Setting up">
        <div className="ffr-panel">
          <ol className="ffr-steps">{t.setup.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
        <div className="ffr-two">
          <figure className="ffr-panel">
            <div className="ffr-fan" aria-label={t.setup.deck_caption}>{t.setup.deck.map((id, i) => <span key={i}>{face(id, `deck:${i}`)}</span>)}</div>
            <figcaption className="ffr-note">{t.setup.deck_caption}</figcaption>
          </figure>
          <figure className="ffr-panel">
            <div className="ffr-cards ffr-cards-sm">{t.setup.loadout.map((id) => <span key={id}>{face(id, `starter:${id}`)}</span>)}</div>
            <figcaption className="ffr-note">{t.setup.loadout_caption}</figcaption>
          </figure>
        </div>
      </Section>

      <Section n={4} id="ffr-round" title="A round">
        <div className="ffr-panel">
          <p>{t.round.intro}</p>
          <ol className="ffr-flow" aria-label="The order of a round">
            {['First player', 'Second player'].map((who) => (
              <li key={who} className="ffr-turn">
                <span className="ff-kicker">{who}'s turn</span>
                <ol>{t.round.turn.map((s, i) => <li key={s.name}><span className={`ff-step${i === 0 ? ' current' : ''}`}>{s.name}</span></li>)}</ol>
              </li>
            ))}
            <li className="ffr-flow-strike"><span className="ffr-burst" aria-hidden="true" /><b>{t.round.strike.name}</b></li>
          </ol>
          <dl className="ffr-defs">
            {[...t.round.turn, t.round.strike].map((s) => <div key={s.name}><dt>{s.name}</dt><dd>{s.text}</dd></div>)}
          </dl>
          <p className="ffr-note">{t.round.note}</p>
        </div>
      </Section>

      <Section n={5} id="ffr-technique" title="The Technique phase">
        <div className="ffr-panel">
          <p>{t.technique.intro}</p>
          <ExampleView data={data} ex={t.technique.example} />
        </div>
      </Section>

      <Section n={6} id="ffr-effects" title="What the effects mean">
        <div className="ffr-panel">
          <p>{t.effects.intro}</p>
          <dl className="ffr-effects">
            {t.effects.list.map((e) => (
              <div key={e.key}><dt><span className={`ffr-effect ${e.key}`}>+N {e.word}</span></dt><dd>{e.text}</dd></div>
            ))}
          </dl>
        </div>
      </Section>

      <Section n={7} id="ffr-channel" title="The Channel phase">
        <div className="ffr-panel">
          <p>{t.channel.intro}</p>
          <div className="ffr-worth">
            {t.channel.worth.map((w) => (
              <figure key={w.card}>{face(w.card, `worth:${w.card}`)}<figcaption><b>{w.spirit}</b> spirit</figcaption></figure>
            ))}
          </div>
          <ExampleView data={data} ex={t.channel.example} />
        </div>
      </Section>

      <Section n={8} id="ffr-refine" title="Refining and Missteps">
        <div className="ffr-panel">
          <p>{t.refine.intro}</p>
          <div className="ffr-aside">{face('misstep', 'refine:misstep')}<p>{t.refine.missteps}</p></div>
          <ExampleView data={data} ex={t.refine.example} />
        </div>
        <div className="ffr-panel ffr-callout">
          <h3>{t.reload.title}</h3>
          <div className="ffr-aside">{face('focus', 'reload:focus')}<p>{t.reload.text}</p></div>
        </div>
      </Section>

      <Section n={9} id="ffr-cleanup" title="Ending your turn">
        <div className="ffr-panel">
          <p>{t.cleanup.intro}</p>
          <ol className="ffr-steps">{t.cleanup.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      </Section>

      <Section n={10} id="ffr-strike" title="The strike">
        <div className="ffr-panel">
          <p>{t.strike.intro}</p>
          <h3>{t.strike.example.title}</h3>
          <div className="ffr-strike" role="img" aria-label={t.strike.example.steps.slice(0, 2).join(' ')}>
            <Fighter side={t.strike.example.you} />
            <span className="ff-vs">VS</span>
            <Fighter side={t.strike.example.them} right />
          </div>
          <ol className="ffr-steps">{t.strike.example.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="ffr-note">{t.strike.end}</p>
        </div>
      </Section>

      <Section n={11} id="ffr-cards" title="Every card">
        <p className="ffr-intro">{t.cards.intro}</p>
        {t.cards.groups.map((g) => (
          <div key={g.id} className="ffr-panel ffr-group" style={g.school ? { '--ffr-school': PALETTE[`ink-${g.school}`] } as CSSProperties : undefined}>
            <h3>{g.school && <span className="ffr-swatch" aria-hidden="true" />}{g.title}<span className="ff-count">{g.cards.length}</span></h3>
            <p className="ffr-note">{g.text}</p>
            <div className="ffr-cards">{g.cards.map((id) => <span key={id}>{face(id, `list:${id}`)}</span>)}</div>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <div className="ffr-head"><span className="ffr-num">{n}</span><h2 id={id}>{title}</h2></div>
      {children}
    </section>
  );
}

function Face({ data, card, instance }: { data: RulebookData; card: string; instance: string }) {
  return <Card id={`ffr:${instance}`} data={printedCard(card, data.cards as Map<string, CardDef>, `ffr:${instance}`)} />;
}

/** A worked example: the starting hand, then each move with what the counters read after it. */
function ExampleView({ data, ex }: { data: RulebookData; ex: Example }) {
  const keys = Object.keys(ex.start) as Array<keyof Counters>;
  let before: Counters = ex.start;
  return (
    <div className="ffr-example">
      <h3>{ex.title}</h3>
      <div className="ffr-hand">
        <span className="ff-kicker">Your hand</span>
        <div className="ffr-cards ffr-cards-sm">{ex.hand.map((id, i) => <span key={i}><Face data={data} card={id} instance={`${ex.title}:hand:${i}`} /></span>)}</div>
        <Counts keys={keys} now={ex.start} before={ex.start} />
      </div>
      <ol className="ffr-moves">
        {ex.steps.map((s, i) => {
          const was = before;
          before = s.after;
          return (
            <li key={i}>
              <span className="ffr-move-pic">{s.card ? <Face data={data} card={s.card} instance={`${ex.title}:step:${i}`} /> : <span className="ff-step current">Next</span>}</span>
              <span className="ffr-move-text">{s.text}</span>
              <Counts keys={keys} now={s.after} before={was} />
            </li>
          );
        })}
      </ol>
      <p className="ffr-note">{ex.close}</p>
    </div>
  );
}

function Counts({ keys, now, before }: { keys: Array<keyof Counters>; now: Counters; before: Counters }) {
  return (
    <span className="ffr-counters">
      {keys.map((k) => (
        <span key={k} className={`ff-counter${now[k] !== before[k] ? ' changed' : ''}`}><b>{now[k]}</b><span>{COUNTER_WORDS[k]}</span></span>
      ))}
    </span>
  );
}

function Fighter({ side, right = false }: { side: Side; right?: boolean }) {
  return (
    <div className={`ffr-fighter${right ? ' right' : ''}`}>
      <span className="ff-plate-name">{side.name}</span>
      <span className="ffr-chips">
        <span className="ff-chip damage"><b>{side.damage}</b>Damage</span>
        <span className="ff-chip defense"><b>{side.defense}</b>Defense</span>
      </span>
      <span className="ffr-stam" aria-label={`Stamina ${side.stamina} to ${side.after}`}>
        <s>{side.stamina}</s><span aria-hidden="true">→</span><b>{side.after}</b><small>stamina</small>
      </span>
    </div>
  );
}
