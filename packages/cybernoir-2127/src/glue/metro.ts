// The city as a subway map, from docs/design/cybernoir-rain-neon/Metro-Map.dc.html
// (positions and lines) and the fitted map in Table-Detective.dc.html (short
// names and which side each name sits on). Numbers are the board's own
// pixels, so they can be checked against it; `pct` turns them into the
// percent the map primitive takes.
//
// Each faction is a line through its own locations. The lines say who owns a
// place and nothing else: nobody travels on them (the legend says so), and
// they are never tapped or animated. Every fact about a location still comes
// from the engine's reference data; this file only says where to draw it.

/** The boroughs' three boxes on the board, side by side (668 tall there).
 *  The frame runs 32 px further down so the names under the bottom row of
 *  stations stay on the board when the table gives the map less height than
 *  the design does. */
const FRAME = { x: 32, y: 170, w: 1376, h: 700 };
const COLUMN_W = 448;

export function pct(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.round(((x - FRAME.x) / FRAME.w) * 10000) / 100,
    y: Math.round(((y - FRAME.y) / FRAME.h) * 10000) / 100,
  };
}

/** Each borough's column, keyed by the engine's borough id, with the board's tagline. */
export const BOROUGH_COLUMNS: Record<string, { left: number; tagline: string }> = {
  downtown: { left: 32, tagline: 'neon & concrete' },
  the_hive: { left: 496, tagline: 'a billion beds' },
  boonies: { left: 960, tagline: 'off the grid' },
};

export function columnOf(borough: string): { x: number; width: number } | null {
  const c = BOROUGH_COLUMNS[borough];
  if (!c) return null;
  return { x: pct(c.left, FRAME.y).x, width: Math.round((COLUMN_W / FRAME.w) * 10000) / 100 };
}

interface Station { x: number; y: number; side: 'above' | 'below'; short: string }

/** Every location by the engine's printed name. */
export const STATIONS: Record<string, Station> = {
  'OmniSuperUltra Corporate Office #beebee': { x: 220, y: 250, side: 'above', short: 'OSU Corporate' },
  'Platinum Extraluxx Apartments Unit 1337x': { x: 700, y: 300, side: 'above', short: 'Platinum 1337x' },
  'Shipyard': { x: 1180, y: 270, side: 'above', short: 'Shipyard' },
  'Shizuoka Megamall': { x: 130, y: 350, side: 'above', short: 'Megamall' },
  'Suburb Tower #2013': { x: 620, y: 400, side: 'above', short: 'Suburb Tower' },
  'Warehouse': { x: 1270, y: 380, side: 'above', short: 'Warehouse' },
  'The Back Alley': { x: 330, y: 440, side: 'below', short: 'The Back Alley' },
  "Dirty Mel's": { x: 790, y: 490, side: 'above', short: "Dirty Mel's" },
  'The Junction': { x: 1110, y: 470, side: 'above', short: 'The Junction' },
  'Dark City Central Station': { x: 400, y: 550, side: 'below', short: 'Central Station' },
  'Garbage Dump': { x: 690, y: 590, side: 'below', short: 'Garbage Dump' },
  'Trailer Towers': { x: 1050, y: 580, side: 'below', short: 'Trailer Towers' },
  'Little Ghana': { x: 1290, y: 640, side: 'below', short: 'Little Ghana' },
  'Xistential Club': { x: 180, y: 650, side: 'above', short: 'Xistential Club' },
  'Nature Reserve #42': { x: 590, y: 690, side: 'below', short: 'Nature Reserve' },
  'Tower Furnace': { x: 1200, y: 720, side: 'below', short: 'Tower Furnace' },
  'Sewers': { x: 300, y: 770, side: 'below', short: 'Sewers' },
  'Resident Block #8008315': { x: 810, y: 780, side: 'below', short: 'Resident Block' },
  'Junktown': { x: 1090, y: 790, side: 'below', short: 'Junktown' },
};

/** Each line's code, as on its bullets, keyed by the engine's affiliation id. */
export const LINE_CODES: Record<string, string> = {
  corp_1: 'OSU', corp_2: 'SHZ', gang_1: 'ICE', none: 'CIV', gang_2: 'CRM', gang_3: 'CHM',
};

/** The six lines, keyed by the engine's affiliation id, with 45° bends. */
export const LINES: Record<string, Array<[number, number]>> = {
  corp_1: [[160, 250], [220, 250], [435, 250], [485, 300], [700, 300], [925, 300], [955, 270], [1180, 270], [1240, 270]],
  corp_2: [[70, 350], [130, 350], [350, 350], [400, 400], [620, 400], [935, 400], [955, 380], [1270, 380], [1330, 380]],
  gang_1: [[270, 440], [330, 440], [535, 440], [585, 490], [790, 490], [940, 490], [960, 470], [1110, 470], [1170, 470]],
  none: [[340, 550], [400, 550], [525, 550], [565, 590], [690, 590], [865, 590], [875, 580], [1050, 580], [1140, 580], [1200, 640], [1290, 640], [1350, 640]],
  gang_2: [[120, 650], [180, 650], [365, 650], [405, 690], [590, 690], [880, 690], [910, 720], [1200, 720], [1260, 720]],
  gang_3: [[240, 770], [300, 770], [550, 770], [560, 780], [810, 780], [945, 780], [955, 790], [1090, 790], [1150, 790]],
};
