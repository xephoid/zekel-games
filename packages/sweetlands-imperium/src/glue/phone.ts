// What a phone table adds to glue-kit's shapes. @zekel/glue-kit 0.1.1 has
// these fields (TablePlan.titleShort, GameScreenProps.menuSlot and openMenu);
// they are declared here too so this package still builds against 0.1.0.
// Once zekel-games moves to glue-kit 0.1.1 these become the kit's own types.

import type { GameScreenProps, TablePlan } from '@zekel/glue-kit';

export type PhonePlan = TablePlan & {
  /** the title on a phone's top bar, when the full one does not fit */
  titleShort?: string;
};

export type PhoneScreenProps = GameScreenProps & {
  /** a place at the top of the phone's open menu sheet (a portal target) */
  menuSlot?: HTMLElement | null;
  /** open the table's menu sheet */
  openMenu?: () => void;
};
