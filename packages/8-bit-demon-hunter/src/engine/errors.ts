// Rule violations raised by the engine. index.ts maps them onto the
// framework's GameError so the engine stays free of @zekel/game-kit.

export type RuleErrorCode = 'ILLEGAL_MOVE' | 'NOT_YOUR_TURN' | 'GAME_OVER' | 'INVALID_PLAYERS';

export class RuleError extends Error {
  constructor(
    public readonly code: RuleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

export function refuse(message: string): never {
  throw new RuleError('ILLEGAL_MOVE', message);
}
