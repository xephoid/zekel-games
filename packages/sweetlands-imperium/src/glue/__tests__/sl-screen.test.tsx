// The Sweetlands candy screen (glue/sl), drawn from a view in the engine's
// shape. What it shows comes from the view and the reference data; what it
// sends is only ever a move the engine listed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { GameReferenceResponse } from '@zekel/wire-types';
import { SlScreen } from '../SlScreen.js';
import type { GameScreenProps, GlueInput, LegalMove } from '@zekel/glue-kit';

const loc = {
  start: (region: number) => ({ zone: 'start', region }),
  ring: (region: number, ringIndex: number) => ({ zone: 'ring', region, ringIndex }),
};

export const SL_SCREEN_VIEW = {
  game_id: 'sweetlands-imperium', phase: 'play', round: 4, active_player_id: 'p1', first_player_id: 'p1',
  taxes: { '1': 0, '2': 2, '3': 1, '4': 0 }, foe: { type: 'orc', defeated: false }, castle_occupant_id: null,
  intel_deck_count: 52, intel_discard_count: 13,
  random_treat_placement: { '1': 'cupcake', '2': 'gummy_bear', '3': 'ice_cream', '4': 'chocolate_bar' },
  players: [
    { player_id: 'p1', kind: 'human', faction: 'milkshake', faction_name: 'Arch Duchess of Milkshake', home_region: 1, points: 2, influence: 3, sugar_cubes: 4, intel_tokens: ['blue'], hand_count: 4,
      unit_locations: { leader: loc.ring(1, 2), knight: loc.ring(2, 3), ambassador: loc.ring(4, 1) } },
    { player_id: 'p2', kind: 'ai', faction: 'fudge', faction_name: 'General Fudge', home_region: 2, points: 5, influence: 4, sugar_cubes: 3, intel_tokens: [], hand_count: 1,
      unit_locations: { leader: loc.ring(2, 1), knight: loc.ring(2, 6), ambassador: loc.start(2) } },
  ],
  your_hand: [
    { card_id: 'c1', kind: 'single', color: 'red' },
    { card_id: 'c2', kind: 'double', color: 'blue' },
    { card_id: 'c3', kind: 'treat', treat: 'gummy_bear' },
    { card_id: 'c4', kind: 'single', color: 'green' },
  ],
  your_secret_objectives: ['defeat_knight'], your_turn_step: 'play',
};

export function slReference(extra: Record<string, unknown> = {}): GameReferenceResponse {
  return {
    gameId: 'sweetlands-imperium', rules: '', moveSchema: {}, optionsSchema: {},
    referenceData: { points_to_win: 5, foes: [{ type: 'dragon', dice: 5 }, { type: 'orc', dice: 3 }, { type: 'fiend', dice: 2 }], ...extra },
  } as GameReferenceResponse;
}

export function slProps(over: { view?: unknown; legalMoves?: LegalMove[]; reference?: GameReferenceResponse | null; playerId?: string | null } = {}, props: Partial<GameScreenProps> = {}): GameScreenProps {
  const input: GlueInput = {
    view: over.view ?? SL_SCREEN_VIEW, previous: null, legalMoves: over.legalMoves ?? [], unavailable: [],
    playerId: over.playerId === undefined ? 'p1' : over.playerId, reference: over.reference === undefined ? slReference() : over.reference,
    seq: 1, engineMove: null, actorPlayerId: null, memory: new Map(),
  } as GlueInput;
  return {
    input, yourTurn: true, busy: false, interactive: true,
    onMove: vi.fn(), onForm: vi.fn(), nameFor: (pid: string) => (pid === 'p2' ? 'AI (easy)' : 'Guest'),
    ...props,
  };
}

beforeEach(() => { localStorage.setItem('zk:sl-how-to-play-seen', '1'); });
afterEach(cleanup);

describe('the players panel', () => {
  it('shows each seat: your card first with its turn pill, points to go, and every piece’s place', () => {
    render(<SlScreen {...slProps()} />);
    const panel = screen.getByLabelText('Players and their pieces');
    const cards = within(panel).getAllByRole('region');
    expect(cards).toHaveLength(2);
    const [mine, fudge] = cards;
    expect(within(mine!).getByText('You · Milkshake')).toBeTruthy();
    expect(within(mine!).getByText('Your turn')).toBeTruthy();
    expect(within(mine!).getByRole('img', { name: '2 of 5 points, 3 to go' })).toBeTruthy();
    expect(within(fudge!).getByText('AI')).toBeTruthy();
    expect(within(fudge!).getByRole('img', { name: '5 of 5 points, Winner!' })).toBeTruthy();
    // Where each piece is: the swatch and the land, the full place as a tooltip.
    const knight = within(mine!).getByRole('button', { name: /Knight/ });
    expect(knight.getAttribute('title')).toBe('Your Knight — green space · Fudge’s land');
    expect(within(fudge!).getByRole('button', { name: /Ambassador/ }).textContent).toContain('at home');
  });

  it('writes influence against the cap only when the engine’s reference data gives one', () => {
    const { unmount } = render(<SlScreen {...slProps()} />);
    expect(screen.getAllByText((_, el) => el?.textContent === '3 influence')).toHaveLength(1);
    unmount();
    render(<SlScreen {...slProps({ reference: slReference({ influence_cap: 5 }) })} />);
    expect(screen.getAllByText((_, el) => el?.textContent === '3/5 influence')).toHaveLength(1);
  });

  it('rings a piece on the board and its row together, and sends nothing', () => {
    const props = slProps();
    render(<SlScreen {...props} />);
    const row = screen.getAllByRole('button', { name: /Knight/ }).find((b) => b.classList.contains('sl-piece-row'))!;
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    const onBoard = screen.getByRole('button', { name: 'Your Knight — green space · Fudge’s land' });
    expect(onBoard.classList.contains('focused')).toBe(true);
    fireEvent.click(onBoard);
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(props.onMove).not.toHaveBeenCalled();
  });
});

describe('the hand', () => {
  const LEGAL: LegalMove[] = [
    { move_id: 'r1', description: 'Play red: move knight and take the red action.', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: false, takeAction: true } },
    { move_id: 'b1', description: 'Play double blue (acts twice): move ambassador only (no action).', move: { type: 'play_intel', cardId: 'c2', unit: 'ambassador', viaRoad: false, takeAction: false } },
    { move_id: 't1', description: 'Discard 4 Intel to gain one purple Intel.', move: { type: 'discard_for_color', cardIds: ['c1', 'c2', 'c3', 'c4'], color: 'purple' } },
    { move_id: 't2', description: 'Discard 4 Intel to gain one red Intel.', move: { type: 'discard_for_color', cardIds: ['c1', 'c2', 'c3', 'c4'], color: 'red' } },
  ];

  it('draws each card as a named wrapper: the action, who it helps, ×2 on a double, the treat’s picture', () => {
    render(<SlScreen {...slProps({ legalMoves: LEGAL })} />);
    const hand = screen.getByRole('region', { name: 'Your hand' });
    const red = within(hand).getByRole('button', { name: 'Red card: Battle' });
    expect(red.textContent).toContain('Best with your Knight');
    const blue = within(hand).getByRole('button', { name: 'Blue double card: Intel' });
    expect(blue.textContent).toContain('×2');
    expect(blue.textContent).toContain('Twice, same piece');
    const treat = within(hand).getByRole('button', { name: 'Gummy Bear treat card' });
    expect(treat.querySelector('img')!.getAttribute('src')).toBe('/art/sweetlands/treat-jellybean-2.png');
    expect(within(hand).getByText('Deck 52')).toBeTruthy();
    expect(within(hand).getByText('Discard 13')).toBeTruthy();
    expect(within(hand).getByText(/Blue Intel token/)).toBeTruthy();
  });

  it('lifts a picked card and sends nothing; a card the engine lists no move for cannot be picked', () => {
    const props = slProps({ legalMoves: LEGAL });
    render(<SlScreen {...props} />);
    const red = screen.getByRole('button', { name: 'Red card: Battle' });
    fireEvent.click(red);
    expect(red.getAttribute('aria-pressed')).toBe('true');
    expect(red.classList.contains('picked')).toBe(true);
    fireEvent.click(red);
    expect(red.getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'Green card: Free play' }) as HTMLButtonElement).disabled).toBe(true);
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it('names the trade-in from the engine’s own move: how many cards, and only when it is listed', () => {
    const { unmount } = render(<SlScreen {...slProps({ legalMoves: LEGAL })} />);
    expect(screen.getByRole('button', { name: 'Trade 4 cards for any color' })).toBeTruthy();
    unmount();
    render(<SlScreen {...slProps({ legalMoves: LEGAL.slice(0, 2) })} />);
    expect(screen.queryByRole('button', { name: /^Trade/ })).toBeNull();
  });

  it('trades in only the cards and color the player picks, as the engine’s listed template', () => {
    const props = slProps({ legalMoves: LEGAL });
    render(<SlScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Trade 4 cards for any color' }));
    fireEvent.click(screen.getByRole('button', { name: /Red · Battle/ }));
    const form = screen.getByRole('dialog', { name: 'Discard 4 Intel for Red' });
    const boxes = within(form).getAllByRole('checkbox');
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    for (const b of boxes) fireEvent.click(b);
    fireEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(props.onForm).toHaveBeenCalledTimes(1);
    const [template, move] = (props.onForm as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(template.move_id).toBe('t2');
    expect(move).toEqual({ type: 'discard_for_color', cardIds: ['c1', 'c2', 'c3', 'c4'], color: 'red' });
    expect(props.onMove).not.toHaveBeenCalled();
  });

  it('dims the rest of the hand once the card is played', () => {
    render(<SlScreen {...slProps({ view: { ...SL_SCREEN_VIEW, your_turn_step: 'influence' } })} />);
    expect(screen.getByRole('button', { name: 'Red card: Battle' }).classList.contains('dim')).toBe(true);
  });

  it('shows the secret goal in the engine’s words', () => {
    render(<SlScreen {...slProps({ reference: slReference({ secret_objectives: [{ id: 'defeat_knight', description: 'Defeat a knight in battle.' }] }) })} />);
    expect(screen.getByText('Defeat a knight in battle.')).toBeTruthy();
  });
});


describe('the turn panel', () => {
  const ring = (region: number, ringIndex: number) => ({ zone: 'ring', region, ringIndex });
  const knightLanding = { piece: 'knight', from: ring(2, 3), to: ring(2, 6), path: [ring(2, 4), ring(2, 5), ring(2, 6)] };
  const roadLanding = { piece: 'knight', from: ring(2, 3), to: { zone: 'road', region: 2, roadIndex: 0 }, path: [ring(2, 4), ring(2, 5), { zone: 'road', region: 2, roadIndex: 0 }] };
  const PLAY: LegalMove[] = [
    { move_id: 'k-act', description: 'Play red: move knight around ring and take the red action.', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: false, takeAction: true }, landing: knightLanding },
    { move_id: 'k-move', description: 'Play red: move knight around ring only (no action).', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: false, takeAction: false }, landing: knightLanding },
    { move_id: 'k-road', description: 'Play red: move knight via road and take the red action.', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: true, takeAction: true }, landing: roadLanding },
    { move_id: 'k-road-move', description: 'Play red: move knight via road only (no action).', move: { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: true, takeAction: false }, landing: roadLanding },
    { move_id: 'pass', description: 'Pass your turn to gain 1 influence.', move: { type: 'pass' } },
  ] as LegalMove[];
  const panel = () => screen.getByRole('region', { name: 'What to do now' });

  it('starts at "Play one card", with Pass as a choice the player presses', () => {
    const props = slProps({ legalMoves: PLAY });
    render(<SlScreen {...props} />);
    expect(within(panel()).getByRole('heading', { name: 'Play one card' })).toBeTruthy();
    expect(screen.getByLabelText('Your turn has four steps').querySelector('[aria-current="step"]')!.textContent).toContain('Play a card');
    fireEvent.click(within(panel()).getByRole('button', { name: 'Pass instead (+1 influence, ends turn)' }));
    expect(props.onMove).toHaveBeenCalledWith(PLAY[4]);
  });

  it('numbers one option per piece per destination, ring and road apart, outlined where the engine says it lands', () => {
    const props = slProps({ legalMoves: PLAY });
    render(<SlScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Red card: Battle' }));
    const options = within(panel()).getAllByRole('button').filter((b) => b.classList.contains('sl-option'));
    expect(options.map((b) => b.querySelector('b')!.textContent)).toEqual([
      'Knight → the red space in Fudge’s land',
      'Knight → the red road space in Fudge’s land',
    ]);
    // The sentence is the engine's own description.
    expect(options[0]!.textContent).toContain('Play red: move knight around ring and take the red action.');
    // The outlines sit on the engine's landing tiles, with the same numbers.
    expect(document.querySelector('[data-tile="r2-ring-5"] .sl-mark-n')).toBeNull();
    expect(document.querySelector('[data-tile="r2-ring-6"] .sl-mark-n')!.textContent).toBe('1');
    expect(document.querySelector('[data-tile="r2-road-0"] .sl-mark-n')!.textContent).toBe('2');
    expect(props.onMove).not.toHaveBeenCalled();
    // Choosing on the board: only that outline stays, and the panel asks act or just move.
    fireEvent.click(screen.getByRole('button', { name: /^Option 2:/ }));
    expect(document.querySelectorAll('.sl-mark')).toHaveLength(1);
    expect(document.querySelector('.sl-mark.chosen')).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Just move' }));
    expect(props.onMove).toHaveBeenCalledWith(PLAY[3]);
  });

  it('asks for Roll before a foe battle: blank dice first, and the engine rolls only on the press', () => {
    const foe = { ...PLAY[0]!, description: 'Play red: move knight and take the red action. The server rolls your sugar cubes against the foe when you press this.' } as LegalMove;
    const props = slProps({ legalMoves: [foe, PLAY[1]!] });
    render(<SlScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Red card: Battle' }));
    fireEvent.click(within(panel()).getAllByRole('button').find((b) => b.classList.contains('sl-option'))!);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Move and battle' }));
    expect(props.onMove).not.toHaveBeenCalled();
    expect(panel().querySelectorAll('.sl-die.blank')).toHaveLength(4 + 3); // your 4 sugar cubes, the orc's 3
    fireEvent.click(within(panel()).getByRole('button', { name: 'Roll' }));
    expect(props.onMove).toHaveBeenCalledWith(foe);
  });

  it('shows a battle’s dice from the engine’s record once it is new, until Continue', () => {
    const { rerender } = render(<SlScreen {...slProps({ legalMoves: [] }, { yourTurn: false })} />);
    expect(screen.queryByRole('heading', { name: 'Battle!' })).toBeNull();
    const view = { ...SL_SCREEN_VIEW, last_battle: { id: 1, round: 4, kind: 'knight', attacker: { player_id: 'p1', faces: [3, 0, 2, 1], total: 6 }, defender: { player_id: 'p2', foe: null, faces: [1, 0, 0], total: 1 }, winner: 'attacker' } };
    rerender(<SlScreen {...slProps({ view, legalMoves: [] }, { yourTurn: false })} />);
    expect(within(panel()).getByRole('heading', { name: 'Battle!' })).toBeTruthy();
    expect([...panel().querySelectorAll('.sl-die.rolled')].map((d) => d.textContent)).toEqual(['3', '0', '2', '1', '1', '0', '0']);
    expect(within(panel()).getByText('Your Knight wins.')).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('heading', { name: 'Battle!' })).toBeNull();
  });

  it('gives Recall, Draw and Influence the same panel, each choice in the engine’s words', () => {
    const recall: LegalMove[] = [
      { move_id: 'r0', description: 'Skip recall (gain Intel, then play).', move: { type: 'recall', units: [] } },
      { move_id: 'r1', description: 'Recall your knight to start, then gain Intel.', move: { type: 'recall', units: ['knight'] } },
    ];
    const props = slProps({ view: { ...SL_SCREEN_VIEW, your_turn_step: 'recall' }, legalMoves: recall });
    const first = render(<SlScreen {...props} />);
    expect(within(panel()).getByRole('heading', { name: 'Recall' })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Recall your knight to start, then gain Intel.' }));
    expect(props.onMove).toHaveBeenCalledWith(recall[1]);
    first.unmount();

    const onDraw = vi.fn();
    const draw = slProps({ legalMoves: [{ move_id: 'd', description: 'Draw 2 Intel card(s) (the server deals them when you press this).', move: { type: 'resolve_report' } }] }, { onDraw });
    const second = render(<SlScreen {...draw} />);
    fireEvent.click(within(panel()).getByRole('button', { name: 'Draw' }));
    expect(onDraw).toHaveBeenCalledTimes(1);
    expect(draw.onMove).not.toHaveBeenCalled();
    second.unmount();

    const spend: LegalMove[] = [
      { move_id: 'b', description: 'Buy a red Intel token (1 influence).', move: { type: 'buy_intel_token', color: 'red' } },
      { move_id: 'e', description: 'End your turn.', move: { type: 'end_turn' } },
    ];
    const inf = slProps({ view: { ...SL_SCREEN_VIEW, your_turn_step: 'influence' }, legalMoves: spend });
    render(<SlScreen {...inf} />);
    expect(within(panel()).getByRole('heading', { name: 'Spend influence' })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'End turn' }));
    expect(inf.onMove).toHaveBeenCalledWith(spend[1]);
  });
});

describe('the color guide', () => {
  it('is always on screen, one row per color, and outlines the picked card’s color', () => {
    const legal = [{ move_id: 'b', description: 'Play double blue (acts twice): move ambassador only (no action).', move: { type: 'play_intel', cardId: 'c2', unit: 'ambassador', viaRoad: false, takeAction: false } }] as LegalMove[];
    render(<SlScreen {...slProps({ legalMoves: legal }, { yourTurn: false })} />);
    const guide = screen.getByRole('region', { name: 'What each color does' });
    const rows = within(guide).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('b')!.textContent)).toEqual(['Red · Battle', 'Orange · Influence', 'Yellow · Taxes', 'Green · Free play', 'Blue · Intel', 'Purple · Castle']);
    expect(guide.querySelector('li.on')).toBeNull();
    cleanup();
    render(<SlScreen {...slProps({ legalMoves: legal })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Blue double card: Intel' }));
    const on = screen.getByRole('region', { name: 'What each color does' }).querySelector('li.on')!;
    expect(on.querySelector('b')!.textContent).toBe('Blue · Intel');
  });
});

describe('how to play', () => {
  const ref = () => slReference({
    public_objectives: [{ id: 'defeat_foe', points: 3, description: 'Defeat the foe in the castle.' }, { id: 'capture_leader', points: 1, description: 'Capture a leader.' }],
    secret_objectives: [{ id: 'defeat_knight', points: 2, description: 'Defeat a knight in battle.' }],
    sugar_die_faces: [0, 0, 0, 1, 2, 3],
  });

  it('opens by itself before a seat’s first game, with the goals and dice from the reference data, and not again', () => {
    localStorage.clear();
    render(<SlScreen {...slProps({ reference: ref() }, { yourTurn: false })} />);
    const sheet = screen.getByRole('dialog', { name: 'How to play Sweetlands Imperium' });
    expect(within(sheet).getByText('Be first to 5 points')).toBeTruthy();
    expect(within(sheet).getAllByRole('listitem').slice(0, 3).map((li) => li.textContent)).toEqual([
      'Defeat the foe in the castle.3', 'Your secret goal (only you can see it).2', 'Capture a leader.1',
    ]);
    expect(within(sheet).getByText(/Each one rolls 0, 0, 0, 1, 2 or 3\./)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Got it, let’s play' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(<SlScreen {...slProps({ reference: ref() }, { yourTurn: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    expect(screen.getByRole('dialog', { name: 'How to play Sweetlands Imperium' })).toBeTruthy();
  });

  it('does not open by itself for a watcher', () => {
    localStorage.clear();
    render(<SlScreen {...slProps({ playerId: null }, { yourTurn: false, interactive: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Red captures: the player picks who', () => {
  const ring = (region: number, ringIndex: number) => ({ zone: 'ring', region, ringIndex });
  const landing = { piece: 'knight', from: ring(2, 3), to: ring(2, 6), path: [ring(2, 4), ring(2, 5), ring(2, 6)] };
  const base = { type: 'play_intel', cardId: 'c1', unit: 'knight', viaRoad: false };
  const CAPTURES: LegalMove[] = [
    { move_id: 'cap-l-s', description: "Play red: move knight and take the red action, capturing p2's leader, scoring your secret \"capture a leader\".", move: { ...base, takeAction: true, targetPlayerId: 'p2', targetUnit: 'leader', captureLeaderScores: 'secret' }, landing },
    { move_id: 'cap-l-p', description: "Play red: move knight and take the red action, capturing p2's leader, scoring the public \"capture a leader\".", move: { ...base, takeAction: true, targetPlayerId: 'p2', targetUnit: 'leader', captureLeaderScores: 'public' }, landing },
    { move_id: 'cap-a', description: "Play red: move knight and take the red action, capturing p2's ambassador.", move: { ...base, takeAction: true, targetPlayerId: 'p2', targetUnit: 'ambassador' }, landing },
    { move_id: 'just', description: 'Play red: move knight only (no action).', move: { ...base, takeAction: false }, landing },
  ] as LegalMove[];
  const panel = () => screen.getByRole('region', { name: 'What to do now' });

  it('shows one button per capture the engine listed, and sends the one pressed', () => {
    const props = slProps({ legalMoves: CAPTURES });
    render(<SlScreen {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Red card: Battle' }));
    fireEvent.click(within(panel()).getAllByRole('button').find((b) => b.classList.contains('sl-option'))!);
    expect(within(panel()).getByRole('button', { name: 'Capture AI (easy)’s Leader (scores your secret goal, +2)' })).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: 'Capture AI (easy)’s Leader (scores the public goal, +1)' })).toBeTruthy();
    // the shared sentence speaks for no one option
    expect(within(panel()).getByText('Taking the action captures one enemy piece there. Pick which:')).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Capture AI (easy)’s Ambassador' }));
    expect(props.onMove).toHaveBeenCalledWith(CAPTURES[2]);
  });

  it('keeps the warning when an enemy Knight there must be beaten first', () => {
    const guarded = CAPTURES.map((m) => (m.move['takeAction']
      ? { ...m, description: `${m.description} (you must first beat p2's knight in that region; losing that battle cancels the capture)` }
      : m)) as LegalMove[];
    render(<SlScreen {...slProps({ legalMoves: guarded })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Red card: Battle' }));
    fireEvent.click(within(panel()).getAllByRole('button').find((b) => b.classList.contains('sl-option'))!);
    expect(within(panel()).getByRole('button', { name: 'Capture AI (easy)’s Ambassador. Beat the Knight there first; losing cancels the capture' })).toBeTruthy();
  });

  it("a double red card's second capture gets its own panel", () => {
    const SECOND: LegalMove[] = [
      { move_id: 's-l', description: "Second Red of your double card: capturing p2's leader.", move: { type: 'choose_capture', targetPlayerId: 'p2', targetUnit: 'leader' } },
      { move_id: 's-a', description: "Second Red of your double card: capturing p2's ambassador.", move: { type: 'choose_capture', targetPlayerId: 'p2', targetUnit: 'ambassador' } },
    ] as LegalMove[];
    const props = slProps({ legalMoves: SECOND });
    render(<SlScreen {...props} />);
    expect(within(panel()).getByRole('heading', { name: 'Second capture' })).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Capture AI (easy)’s Leader' }));
    expect(props.onMove).toHaveBeenCalledWith(SECOND[0]);
  });
});
