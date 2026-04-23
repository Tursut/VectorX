// Wire format for VectorX online multiplayer.
//
// Every JSON message exchanged over the WebSocket is validated against a
// schema in this file. Unknown or malformed payloads are rejected at the
// boundary (DO fetch handler in Step 9+), which means the rest of the server
// code can trust its inputs.
//
// Layout:
//   - Primitives (RoomCode, PlayerId, DisplayName, Coord)
//   - Player identity — LobbyPlayer (lobby phase) and GamePlayer (game phase).
//     Deliberately split so `GAME_STATE.players` matches `src/game/logic.js`
//     byte-for-byte. The Step 14 `useNetworkGame` contract test relies on this.
//   - Game sub-shapes (Cell, Grid, Item, LastEvent)
//   - Messages, each with a literal `type` — client→server (HELLO/START/MOVE)
//     and server→client (JOIN/LOBBY_STATE/GAME_STATE/ELIMINATED/GAME_OVER/ERROR).
//   - Discriminated unions ClientMsg and ServerMsg.
//   - Inferred TypeScript types + one `parseClientMsg` helper used by Step 9's
//     DO handler.
//
// Conventions:
//   - Every `z.object(...)` is `.strict()` — unknown keys reject. Client and
//     server ship together; typos on the wire are bugs, not forward-compat.
//   - Schemas never mutate input. `DisplayName` REJECTS leading/trailing
//     whitespace rather than trimming, so `parse` round-trips.
//   - `deathCell` and `finishTurn` are always-present-but-nullable to mirror
//     `logic.js` exactly. No `.optional()` on the game shape.

import { z } from 'zod';

// Bump when the wire format changes incompatibly. HELLO.version must match;
// server rejects mismatches. Cheap insurance once we deploy to production.
export const PROTOCOL_VERSION = 1;

// ---------- Primitives ----------

export const RoomCode = z
  .string()
  .regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/);

export const PlayerId = z.number().int().min(0).max(3);

export const DisplayName = z
  .string()
  .min(1)
  .max(20)
  .regex(/^\S(.*\S)?$/, 'no leading/trailing whitespace');

// Grid is 10×10 (matches GRID_SIZE in src/game/constants.js).
export const Coord = z.number().int().min(0).max(9);

// ---------- Player identity ----------

export const LobbyPlayer = z
  .object({
    id: PlayerId,
    displayName: DisplayName,
    isBot: z.boolean(),
    // Redundant with LOBBY_STATE.hostId but spares the client from ID
    // comparisons to render the crown. DO is authoritative.
    isHost: z.boolean(),
  })
  .strict();

export const GamePlayer = z
  .object({
    id: PlayerId,
    displayName: DisplayName,
    isBot: z.boolean(),
    isHost: z.boolean(),
    row: Coord,
    col: Coord,
    isEliminated: z.boolean(),
    // logic.js sets this to null on init, {row,col} on trap.
    deathCell: z.object({ row: Coord, col: Coord }).strict().nullable(),
    // logic.js sets this in completeTurn when a player is eliminated.
    finishTurn: z.number().int().nullable(),
  })
  .strict();

// ---------- Game sub-shapes ----------

const Cell = z.object({ owner: PlayerId.nullable() }).strict();

// Full 10×10 shape — prevents silent regressions if GRID_SIZE ever changes
// without a protocol version bump.
const Grid = z.array(z.array(Cell).length(10)).length(10);

const Item = z
  .object({
    id: z.string(),
    type: z.enum(['bomb', 'portal', 'freeze', 'swap']),
    row: Coord,
    col: Coord,
    turnsLeft: z.number().int(),
  })
  .strict();

// Mirror of logic.js's lastEvent tagged union. Same payload shape for both
// event types but the discriminator lets the client key animations off it.
const FreezeEvent = z
  .object({
    type: z.literal('freeze'),
    byId: PlayerId,
    targetId: PlayerId,
  })
  .strict();

const SwapEvent = z
  .object({
    type: z.literal('swap'),
    byId: PlayerId,
    targetId: PlayerId,
  })
  .strict();

const LastEvent = z.discriminatedUnion('type', [FreezeEvent, SwapEvent]).nullable();

// ---------- Client → Server ----------

export const HelloMsg = z
  .object({
    type: z.literal('HELLO'),
    version: z.literal(PROTOCOL_VERSION),
    displayName: DisplayName,
  })
  .strict();

export const StartMsg = z
  .object({
    type: z.literal('START'),
    magicItems: z.boolean(),
  })
  .strict();

export const MoveMsg = z
  .object({
    type: z.literal('MOVE'),
    row: Coord,
    col: Coord,
  })
  .strict();

export const ClientMsg = z.discriminatedUnion('type', [HelloMsg, StartMsg, MoveMsg]);

// ---------- Server → Client ----------

export const JoinMsg = z
  .object({
    type: z.literal('JOIN'),
    player: LobbyPlayer,
  })
  .strict();

export const LobbyStateMsg = z
  .object({
    type: z.literal('LOBBY_STATE'),
    code: RoomCode,
    players: z.array(LobbyPlayer).max(4),
    magicItems: z.boolean(),
    hostId: PlayerId.nullable(),
  })
  .strict();

export const GameStateMsg = z
  .object({
    type: z.literal('GAME_STATE'),
    grid: Grid,
    players: z.array(GamePlayer).length(4),
    currentPlayerIndex: PlayerId,
    phase: z.enum(['playing', 'gameover']),
    winner: PlayerId.nullable(),
    turnCount: z.number().int().min(0),
    magicItems: z.boolean(),
    items: z.array(Item),
    nextSpawnIn: z.number().int(),
    portalActive: z.boolean(),
    swapActive: z.boolean(),
    freezeSelectActive: z.boolean(),
    frozenPlayerId: PlayerId.nullable(),
    frozenTurnsLeft: z.number().int().min(0),
    lastEvent: LastEvent,
  })
  .strict();

export const EliminatedMsg = z
  .object({
    type: z.literal('ELIMINATED'),
    playerId: PlayerId,
    reason: z.enum(['trapped', 'timeout', 'disconnect']),
  })
  .strict();

export const GameOverMsg = z
  .object({
    type: z.literal('GAME_OVER'),
    winner: PlayerId.nullable(),
    players: z.array(GamePlayer).length(4),
  })
  .strict();

export const ErrorMsg = z
  .object({
    type: z.literal('ERROR'),
    code: z.enum([
      'NOT_YOUR_TURN',
      'INVALID_MOVE',
      'ROOM_FULL',
      'DUPLICATE_NAME',
      'UNAUTHORIZED',
      'BAD_PAYLOAD',
      'ALREADY_STARTED',
    ]),
    message: z.string().optional(),
  })
  .strict();

export const ServerMsg = z.discriminatedUnion('type', [
  JoinMsg,
  LobbyStateMsg,
  GameStateMsg,
  EliminatedMsg,
  GameOverMsg,
  ErrorMsg,
]);

// ---------- Inferred types ----------

export type RoomCode = z.infer<typeof RoomCode>;
export type PlayerId = z.infer<typeof PlayerId>;
export type DisplayName = z.infer<typeof DisplayName>;
export type LobbyPlayer = z.infer<typeof LobbyPlayer>;
export type GamePlayer = z.infer<typeof GamePlayer>;
export type ClientMsg = z.infer<typeof ClientMsg>;
export type ServerMsg = z.infer<typeof ServerMsg>;
export type HelloMsg = z.infer<typeof HelloMsg>;
export type StartMsg = z.infer<typeof StartMsg>;
export type MoveMsg = z.infer<typeof MoveMsg>;
export type JoinMsg = z.infer<typeof JoinMsg>;
export type LobbyStateMsg = z.infer<typeof LobbyStateMsg>;
export type GameStateMsg = z.infer<typeof GameStateMsg>;
export type EliminatedMsg = z.infer<typeof EliminatedMsg>;
export type GameOverMsg = z.infer<typeof GameOverMsg>;
export type ErrorMsg = z.infer<typeof ErrorMsg>;

// ---------- Helper ----------

// Single entry point for server-side client-message validation. Step 9's DO
// handler uses this; keeping it in protocol.ts means the error code is
// defined right next to the schema that produces it.
export function parseClientMsg(
  raw: unknown,
): { ok: true; msg: ClientMsg } | { ok: false; code: 'BAD_PAYLOAD' } {
  const r = ClientMsg.safeParse(raw);
  return r.success ? { ok: true, msg: r.data } : { ok: false, code: 'BAD_PAYLOAD' };
}
