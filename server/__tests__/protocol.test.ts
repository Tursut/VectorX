import { describe, it, expect } from 'vitest';
import {
  ClientMsg,
  EliminatedMsg,
  ErrorMsg,
  GameOverMsg,
  GameStateMsg,
  HelloMsg,
  JoinMsg,
  LobbyStateMsg,
  MoveMsg,
  PROTOCOL_VERSION,
  ServerMsg,
  StartMsg,
  parseClientMsg,
} from '../protocol';

// ---------- Fixtures ----------

const validLobbyPlayer = {
  id: 0,
  displayName: 'Alice',
  isBot: false,
  isHost: true,
};

const validGamePlayer = {
  id: 0,
  displayName: 'Alice',
  isBot: false,
  isHost: true,
  row: 0,
  col: 0,
  isEliminated: false,
  deathCell: null,
  finishTurn: null,
};

// 10×10 all-empty grid
const emptyGrid = Array.from({ length: 10 }, () =>
  Array.from({ length: 10 }, () => ({ owner: null })),
);

const validGameStateBody = {
  grid: emptyGrid,
  players: [
    validGamePlayer,
    { ...validGamePlayer, id: 1, displayName: 'Bob', isHost: false, col: 9 },
    { ...validGamePlayer, id: 2, displayName: 'Cat', isHost: false, row: 9, col: 9 },
    { ...validGamePlayer, id: 3, displayName: 'Dan', isHost: false, row: 9 },
  ],
  currentPlayerIndex: 0,
  phase: 'playing' as const,
  winner: null,
  turnCount: 0,
  magicItems: true,
  items: [],
  nextSpawnIn: 5,
  portalActive: false,
  swapActive: false,
  freezeNextPlayer: false,
  lastEvent: null,
};

// ---------- Valid round-trips, one per message type ----------

describe('valid messages round-trip without mutation', () => {
  it('HELLO', () => {
    const msg = { type: 'HELLO', version: PROTOCOL_VERSION, displayName: 'Alice' };
    expect(HelloMsg.parse(msg)).toEqual(msg);
  });

  it('START', () => {
    const msg = { type: 'START', magicItems: true };
    expect(StartMsg.parse(msg)).toEqual(msg);
  });

  it('MOVE', () => {
    const msg = { type: 'MOVE', row: 3, col: 7 };
    expect(MoveMsg.parse(msg)).toEqual(msg);
  });

  it('JOIN', () => {
    const msg = { type: 'JOIN', player: validLobbyPlayer };
    expect(JoinMsg.parse(msg)).toEqual(msg);
  });

  it('LOBBY_STATE', () => {
    const msg = {
      type: 'LOBBY_STATE',
      code: 'ABCDE',
      players: [validLobbyPlayer],
      magicItems: true,
      hostId: 0,
    };
    expect(LobbyStateMsg.parse(msg)).toEqual(msg);
  });

  it('GAME_STATE', () => {
    const msg = { type: 'GAME_STATE', ...validGameStateBody };
    expect(GameStateMsg.parse(msg)).toEqual(msg);
  });

  it('GAME_STATE with a freeze lastEvent', () => {
    const msg = {
      type: 'GAME_STATE',
      ...validGameStateBody,
      lastEvent: { type: 'freeze', byId: 0, targetId: 1 },
    };
    expect(GameStateMsg.parse(msg)).toEqual(msg);
  });

  it('ELIMINATED', () => {
    const msg = { type: 'ELIMINATED', playerId: 2, reason: 'trapped' };
    expect(EliminatedMsg.parse(msg)).toEqual(msg);
  });

  it('GAME_OVER', () => {
    const msg = {
      type: 'GAME_OVER',
      winner: 0,
      players: validGameStateBody.players,
    };
    expect(GameOverMsg.parse(msg)).toEqual(msg);
  });

  it('ERROR', () => {
    const msg = { type: 'ERROR', code: 'INVALID_MOVE', message: 'not adjacent' };
    expect(ErrorMsg.parse(msg)).toEqual(msg);
  });
});

// ---------- Rejections: one per schema ----------

describe('malformed messages are rejected', () => {
  it('HELLO with wrong protocol version', () => {
    const r = HelloMsg.safeParse({
      type: 'HELLO',
      version: 999,
      displayName: 'Alice',
    });
    expect(r.success).toBe(false);
  });

  it('HELLO with empty displayName', () => {
    const r = HelloMsg.safeParse({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      displayName: '',
    });
    expect(r.success).toBe(false);
  });

  it('HELLO with 21-char displayName', () => {
    const r = HelloMsg.safeParse({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      displayName: 'a'.repeat(21),
    });
    expect(r.success).toBe(false);
  });

  it('HELLO with whitespace-bounded displayName', () => {
    const r = HelloMsg.safeParse({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      displayName: '  Alice  ',
    });
    expect(r.success).toBe(false);
  });

  it('MOVE with row out of bounds', () => {
    expect(MoveMsg.safeParse({ type: 'MOVE', row: 10, col: 0 }).success).toBe(false);
    expect(MoveMsg.safeParse({ type: 'MOVE', row: -1, col: 0 }).success).toBe(false);
  });

  it('MOVE with non-integer coord', () => {
    expect(MoveMsg.safeParse({ type: 'MOVE', row: 1.5, col: 0 }).success).toBe(false);
  });

  it('LOBBY_STATE with 5 players rejects (capacity cap)', () => {
    const r = LobbyStateMsg.safeParse({
      type: 'LOBBY_STATE',
      code: 'ABCDE',
      players: [
        { ...validLobbyPlayer, id: 0 },
        { ...validLobbyPlayer, id: 1, displayName: 'B' },
        { ...validLobbyPlayer, id: 2, displayName: 'C' },
        { ...validLobbyPlayer, id: 3, displayName: 'D' },
        // 5th — PlayerId.max(3) would also reject, but array max is what the
        // plan wants locked at the wire.
        { ...validLobbyPlayer, id: 0, displayName: 'E' },
      ],
      magicItems: false,
      hostId: 0,
    });
    expect(r.success).toBe(false);
  });

  it('GAME_STATE with 9×10 grid rejects', () => {
    const shortGrid = emptyGrid.slice(0, 9);
    const r = GameStateMsg.safeParse({
      type: 'GAME_STATE',
      ...validGameStateBody,
      grid: shortGrid,
    });
    expect(r.success).toBe(false);
  });

  it('ELIMINATED with unknown reason', () => {
    const r = EliminatedMsg.safeParse({
      type: 'ELIMINATED',
      playerId: 0,
      reason: 'quit',
    });
    expect(r.success).toBe(false);
  });

  it('ERROR with unknown code', () => {
    const r = ErrorMsg.safeParse({ type: 'ERROR', code: 'WEIRD' });
    expect(r.success).toBe(false);
  });

  it('LOBBY_STATE with malformed room code', () => {
    const r = LobbyStateMsg.safeParse({
      type: 'LOBBY_STATE',
      code: 'abcde', // lowercase
      players: [],
      magicItems: false,
      hostId: null,
    });
    expect(r.success).toBe(false);
  });
});

// ---------- Strict object guards ----------

describe('strict objects reject unknown keys', () => {
  it('HELLO with extra field', () => {
    const r = HelloMsg.safeParse({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      displayName: 'Alice',
      foo: 1,
    });
    expect(r.success).toBe(false);
  });

  it('GAME_STATE with extra field', () => {
    const r = GameStateMsg.safeParse({
      type: 'GAME_STATE',
      ...validGameStateBody,
      debug: true,
    });
    expect(r.success).toBe(false);
  });
});

// ---------- Discriminated-union coverage ----------

describe('discriminated unions guard direction and type', () => {
  it('ClientMsg rejects unknown type', () => {
    const r = ClientMsg.safeParse({ type: 'UNKNOWN' });
    expect(r.success).toBe(false);
  });

  it('ServerMsg rejects a client-direction message', () => {
    const r = ServerMsg.safeParse({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      displayName: 'Alice',
    });
    expect(r.success).toBe(false);
  });

  it('ClientMsg accepts a valid HELLO', () => {
    const r = ClientMsg.safeParse({
      type: 'HELLO',
      version: PROTOCOL_VERSION,
      displayName: 'Alice',
    });
    expect(r.success).toBe(true);
  });
});

// ---------- parseClientMsg helper ----------

describe('parseClientMsg', () => {
  it('returns ok for a valid message', () => {
    const r = parseClientMsg({ type: 'MOVE', row: 0, col: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg.type).toBe('MOVE');
  });

  it('returns BAD_PAYLOAD for garbage input', () => {
    expect(parseClientMsg({ type: 'NOPE' })).toEqual({ ok: false, code: 'BAD_PAYLOAD' });
    expect(parseClientMsg(null)).toEqual({ ok: false, code: 'BAD_PAYLOAD' });
    expect(parseClientMsg('string')).toEqual({ ok: false, code: 'BAD_PAYLOAD' });
  });
});
