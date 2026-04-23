// Client-side WebSocket wrapper for VectorX online multiplayer.
//
// Wraps a browser WebSocket with:
//   - Typed send/recv using the shared zod schemas from `server/protocol.ts`.
//     Outbound messages are validated against `ClientMsg` (throws on garbage;
//     this is a developer error). Inbound frames are JSON.parsed and validated
//     against `ServerMsg`; malformed traffic is dropped and logged without
//     crashing the caller.
//   - An in-memory send queue: calling `send()` before the socket is OPEN
//     (or during a reconnect) buffers messages in FIFO order and flushes
//     them once the socket reaches OPEN.
//   - Auto-reconnect with jittered exponential backoff: unexpected closes
//     schedule a reconnect at 500ms → 1s → 2s → 4s → 8s → 16s → 30s cap,
//     each with ±25% jitter. Backoff resets on a successful OPEN event.
//   - Explicit `close()`: after an explicit close the wrapper never
//     reconnects — avoids reconnect storms when the caller tears down.
//
// What this wrapper does NOT do (scope limits Step 13):
//   - No session/identity across reconnects. The server treats a reconnected
//     socket as a fresh connection; a caller that wants to reclaim their seat
//     must re-send HELLO and hope the original seat is either vacant or the
//     eliminate-on-disconnect path didn't cull them. A future step can add
//     a server-side session layer (cookie or in-HELLO token) if seat-sticky
//     reconnects become desirable.
//   - No awareness of the game state. That's the `useNetworkGame` hook's job
//     (Step 14), which builds a reducer-shaped state on top of this wrapper.
//
// API:
//   createClient({ url, onMessage, onStateChange }) → { send, close, getState }
//
//   onMessage(msg)       — invoked with each zod-validated ServerMsg.
//   onStateChange(state) — 'connecting' | 'open' | 'closed'. Closed is
//                          transient between reconnect attempts and terminal
//                          after an explicit close; callers can tell them
//                          apart via `getState()` return value `'destroyed'`.
//
// @typedef {import('../../server/protocol').ClientMsg} ClientMsg
// @typedef {import('../../server/protocol').ServerMsg} ServerMsg

import { ClientMsg, ServerMsg } from '../../server/protocol';

// Backoff schedule in milliseconds. Index = attempt count (0-based, capped).
const BACKOFF_STEPS_MS = [500, 1000, 2000, 4000, 8000, 16000, 30000];
const JITTER = 0.25;

/**
 * @param {{
 *   url: string,
 *   onMessage?: (msg: ServerMsg) => void,
 *   onStateChange?: (state: 'connecting' | 'open' | 'closed' | 'destroyed') => void,
 * }} opts
 */
export function createClient({ url, onMessage, onStateChange } = {}) {
  if (!url) throw new Error('createClient: url is required');

  /** @type {ClientMsg[]} — FIFO send queue while socket isn't OPEN */
  const queue = [];
  let ws = null;
  let attempts = 0;
  let reconnectTimer = null;
  // Start at `null` so the first `setState('connecting')` actually fires the
  // callback — otherwise the equality-short-circuit below hides it.
  let state = null;
  let destroyed = false;

  function setState(next) {
    if (state === next) return;
    state = next;
    try { onStateChange?.(next); } catch { /* caller bug; don't crash us */ }
  }

  function scheduleReconnect() {
    if (destroyed || reconnectTimer) return;
    const step = BACKOFF_STEPS_MS[Math.min(attempts, BACKOFF_STEPS_MS.length - 1)];
    // Jitter: base ± (base * JITTER)
    const jitter = (Math.random() * 2 - 1) * step * JITTER;
    const delay = Math.max(0, Math.round(step + jitter));
    attempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!destroyed) connect();
    }, delay);
  }

  function connect() {
    setState('connecting');
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      if (destroyed) return;
      attempts = 0;
      setState('open');
      flushQueue();
    });
    ws.addEventListener('message', (event) => {
      if (destroyed) return;
      handleInbound(event.data);
    });
    ws.addEventListener('close', () => {
      if (destroyed) {
        setState('destroyed');
        return;
      }
      setState('closed');
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // The close event follows; reconnect schedules there.
    });
  }

  function handleInbound(data) {
    let parsed;
    try {
      parsed = typeof data === 'string' ? JSON.parse(data) : null;
    } catch {
      console.warn('[net/client] dropped non-JSON frame');
      return;
    }
    if (parsed === null) {
      console.warn('[net/client] dropped non-text frame');
      return;
    }
    const result = ServerMsg.safeParse(parsed);
    if (!result.success) {
      console.warn('[net/client] dropped malformed ServerMsg', parsed);
      return;
    }
    try {
      onMessage?.(result.data);
    } catch (err) {
      console.error('[net/client] onMessage handler threw', err);
    }
  }

  function flushQueue() {
    while (queue.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
      const msg = queue.shift();
      ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Queue + send a client message. Validates against ClientMsg synchronously;
   * passing a malformed shape throws — this is a developer error, never a
   * runtime failure mode.
   * @param {ClientMsg} msg
   */
  function send(msg) {
    // ClientMsg.parse throws on validation failure; let it propagate.
    const valid = ClientMsg.parse(msg);
    queue.push(valid);
    if (ws && ws.readyState === WebSocket.OPEN) {
      flushQueue();
    }
    // If readyState is CONNECTING or CLOSED, the queue will flush on the next
    // OPEN event. That's how pre-connect sends and reconnect-recovery work.
  }

  /**
   * Close the socket without reconnecting. Idempotent.
   */
  function close() {
    destroyed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try { ws.close(1000); } catch { /* already closed */ }
    }
    setState('destroyed');
  }

  function getState() {
    return state;
  }

  connect();

  return { send, close, getState };
}
