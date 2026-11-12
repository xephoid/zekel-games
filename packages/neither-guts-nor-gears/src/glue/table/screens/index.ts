// Every dedicated NGnG screen, by route. A route missing here renders the
// generic chooser (NggScreen.tsx), which is always correct, if plain.

import type { ComponentType } from 'react';
import type { ScreenCtx } from '../ctx.js';
import type { ScreenKey } from '../route.js';
import { ECONOMY_SCREENS } from './economy.js';
import { BATTLE_SCREENS } from './battle.js';
import { ROUND_SCREENS } from './round.js';

export const SCREENS: Partial<Record<ScreenKey, ComponentType<{ ctx: ScreenCtx }>>> = {
  ...ROUND_SCREENS,
  ...ECONOMY_SCREENS,
  ...BATTLE_SCREENS,
};
