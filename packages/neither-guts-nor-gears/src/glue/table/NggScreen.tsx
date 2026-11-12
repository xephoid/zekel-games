// The NGnG table screen: read the view, route it, and hand the route's screen
// a context. Nothing here decides what to show; route() does, from the state.

import { useMemo, type ComponentType } from 'react';
import type { GameScreenProps } from '@zekel/glue-kit';
import { movesEqual } from '@zekel/glue-kit';
import { makeCtx, type ScreenCtx } from './ctx.js';
import { readView } from './read.js';
import { route, type ScreenKey } from './route.js';
import { TableLayout } from './Layout.js';
import { HowTo, OptionRow, Panel } from './ui.js';
import { SCREENS } from './screens/index.js';
import './ngg.css';

/** Short titles for the generic chooser, one per screen. */
const TITLES: Record<ScreenKey, string> = {
  'setup-table': 'Set up the table',
  'setup-faction': 'Choose your faction',
  'setup-draft': 'Draft your Leader',
  'setup-start': 'Choose a starting site',
  planning: 'Place one card, or pass',
  'core-reallocation': 'Reallocate Cores',
  upkeep: 'Upkeep',
  culture: 'Culture income',
  'end-of-round': 'End of round',
  build: 'Your Build card is resolving',
  'second-purchase': 'A second purchase',
  'access-request': 'Somebody wants your tile',
  research: 'Your Research card is resolving',
  'smyth-reward': "Smyth's reward",
  'move-battle': 'Your Move / Battle card is resolving',
  'elara-spell': "Elara's spell",
  'battle-commit': 'Commit one card, face down — or none',
  'shared-tactics': 'Commit one card, or none',
  'counter-target': 'Point the Counter',
  'battle-extra': 'Your Extra may add up to two',
  'battle-cards': 'The battle cards resolve',
  'battle-activation': 'Activate a unit',
  infiltrator: 'Your hero activates',
  'battle-defense': 'Your defense',
  retreat: 'Retreat, or stay in',
  rally: 'Rally',
  'treaty-response': 'A treaty offer',
  'treaty-break': 'Your treaties',
  'hero-claim': 'Claim a hero',
  'reserved-hero': 'Place a reserved hero',
  'overlay-choice': 'Choose the overlay',
  'dowser-collector': "Dowser's free collector",
  'spy-assign': 'Assign your spy',
  'report-draw': 'Draw a battle card',
  'action-done': 'The action is done',
  table: 'The table',
  'game-over': 'The end',
};

export function screenTitle(key: ScreenKey): string {
  return TITLES[key];
}

/**
 * The chooser every route falls back to: the pending's own options, shut
 * ones struck through with the engine's reason; or, when the pending names no
 * option set, the seat's legal moves in the engine's words. It is always
 * correct, if plain, which is why it is the fallback.
 */
export function GenericScreen({ ctx }: { ctx: ScreenCtx }) {
  const { v, route: r, legal } = ctx;
  const options = v.pending?.for === ctx.me ? v.pending?.options ?? null : null;
  const panel = r.perspective === 'none' && legal.length === 0 ? null : (
    <Panel title={TITLES[r.screen]} tone={r.interrupt ? 'urgent' : undefined}>
      {options
        ? (
          <div className="ngg-options">
            {options.map((o) => {
              const listed = o.move ? legal.find((m) => movesEqual(m.move, o.move!)) : undefined;
              return (
                <OptionRow
                  key={o.id}
                  title={o.label}
                  shutReason={o.blockedReason && ctx.say(o.blockedReason)}
                  disabled={!ctx.live || !listed}
                  onPress={listed ? () => ctx.send(listed) : undefined}
                />
              );
            })}
          </div>
        )
        : legal.length > 0
          ? (
            <div className="ngg-options">
              {legal.map((m, i) => (
                <OptionRow key={i} title={m.description} disabled={!ctx.live} onPress={() => ctx.send(m)} />
              ))}
            </div>
          )
          : <HowTo>Nothing to decide here.</HowTo>}
    </Panel>
  );
  return <TableLayout ctx={ctx} panel={panel} />;
}

export function NggScreen(props: GameScreenProps) {
  const { input } = props;
  const v = useMemo(() => readView(input.view), [input.view]);
  const r = useMemo(() => (v ? route(v, input.playerId, props.yourTurn ? input.legalMoves : []) : null), [v, input.playerId, input.legalMoves, props.yourTurn]);
  if (!v || !r) return null;
  const ctx = makeCtx(props, v, r);
  const Screen: ComponentType<{ ctx: ScreenCtx }> = SCREENS[r.screen] ?? GenericScreen;
  return <Screen ctx={ctx} />;
}
