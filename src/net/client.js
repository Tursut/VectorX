// Client-side WebSocket wrapper for VectorX online multiplayer.
//
// Wraps a browser WebSocket with:
//   - Typed send/recv using the shared zod schemas from `server/protocol.ts`.
//     Outbound messages are validated against `ClientMsg` (throws on garbage;
//     this is a developer error). Inbound frames are JSON.parsed and validated
//     against `ServerMsg`; malformed traffic is dropped and logged without
//     crashing the caller.
//   - An in-memory send queue: calling `send()` before the socket is OPEN
//     buffers messages in FIFO order and flushes them once the socket reaches
//     OPEN. The queue is CLEARED on every disconnect — pre-disconnect user
//     actions (a tap on START / a pending MOVE) are dropped rather than
//     replayed against a fresh socket where they'd land before the new HELLO
//     and trip UNAUTHORIZED.
//   - A `bootstrap` callback that runs on every WS open BEFORE the queue
//     flushes. The hook returns a HELLO message from it, guaranteeing HELLO
//     is always the first frame on every connection — protects against the
//     reconnect race where a user tap is queued and then sent before HELLO.
//   - Auto-reconnect with jittered exponential backoff: unexpected closes
//     schedule a reconnect at 500ms → 1s → 2s → 4s → 8s → 16s → 30s cap,
//     each with ±25% jitter. Backoff resets on a successful OPEN event,
//     and the next reconnect is forced immediately whenever the document
//     transitions to `visible` (covers iOS Safari tab-foreground without
//     waiting out the backoff window).
//   - Explicit `close()`: after an explicit close the wrapper never
//     reconnects — avoids reconnect storms when the caller tears down.
//
// What this wrapper does NOT do:
//   - No client-side session token / identity persistence across reconnects.
//     The server identifies the caller by displayName on each HELLO; the
//     lobby-grace mechanism (server-side) is what makes seat reattachment
//     work for now. A session-token layer is a future step if we want
//     seat-stickiness across full tab close → reopen.
//   - No awareness of the game state. That's the `useNetworkGame` hook's
//     job, which builds a reducer-shaped state on top of this wrapper.
//
// API:
//   createClient({ url, onMessage, onStateChange, bootstrap })
//     → { send, close, getState }
//
//   onMessage(msg)       — invoked with each zod-validated ServerMsg.
//   onStateChange(state) — 'connecting' | 'open' | 'closed' | 'destroyed'.
//                          Closed is transient between reconnect attempts;
//                          destroyed is terminal after an explicit close.
//   bootstrap()          — optional. Called on every WS open; the returned
//                          message (or null) is sent BEFORE the queue flushes.
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
 *   bootstrap?: () => (ClientMsg | null | undefined),
 * }} opts
 */
export function createClient({ url, onMessage, onStateChange, bootstrap } = {}) {
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
  // True once the wrapper has reached OPEN at least once. Distinguishes
  // "initial connecting (queue is fine)" from "reconnecting (drop sends)" so
  // a user tap during a transient disconnect doesn't sit in the queue and
  // fire against post-reconnect state where the action is no longer valid.
  let everConnected = false;

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

  // Force a reconnect now: cancel any pending backoff timer, reset the
  // attempt counter, and call connect() immediately if we're not currently
  // open. Used by the visibilitychange listener so returning to a
  // foregrounded tab feels instant instead of waiting out the backoff.
  function reconnectNow() {
    if (destroyed) return;
    if (state === 'open' || state === 'connecting') return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    attempts = 0;
    connect();
  }

  function connect() {
    setState('connecting');
    ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      if (destroyed) return;
      attempts = 0;
      everConnected = true;
      setState('open');
      // Bootstrap goes FIRST on every connection — this is what makes
      // "HELLO is always the first frame on a new socket" a property of
      // the wrapper, not a happy-path React-effect ordering accident.
      // Bypassing the queue ensures any queued initial-connect messages
      // can never beat HELLO to the wire (server UNAUTHORIZED otherwise).
      if (bootstrap) {
        try {
          const boot = bootstrap();
          if (boot) {
            const valid = ClientMsg.parse(boot);
            ws.send(JSON.stringify(valid));
          }
        } catch (err) {
          console.warn('[net/client] bootstrap threw', err);
        }
      }
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

  // iOS Safari suspends backgrounded tabs and drops their WebSockets within
  // seconds. Returning to the foreground triggers visibilitychange before
  // any of our backoff timers expire — kick a reconnect immediately so the
  // user perceives an instant recovery.
  let visibilityListener = null;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    visibilityListener = () => {
      if (document.visibilityState === 'visible') reconnectNow();
    };
    document.addEventListener('visibilitychange', visibilityListener);
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
   *
   * Drop semantics: messages sent while the socket isn't OPEN are queued
   * during the INITIAL connect (everConnected === false), then flushed on
   * first OPEN. After the first OPEN, sends while not OPEN are DROPPED —
   * they would fire against post-reconnect state where the action may no
   * longer be valid (host status changed, turn advanced, …). The caller
   * can re-tap once the next 'open' event arrives.
   * @param {ClientMsg} msg
   */
  function send(msg) {
    // ClientMsg.parse throws on validation failure; let it propagate.
    const valid = ClientMsg.parse(msg);
    const isOpen = ws && ws.readyState === WebSocket.OPEN;
    if (!isOpen && everConnected) {
      console.warn('[net/client] dropping send while disconnected', valid.type);
      return;
    }
    queue.push(valid);
    if (isOpen) {
      flushQueue();
    }
    // If readyState is CONNECTING (initial only), the queue will flush on
    // the first OPEN event.
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
    if (visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityListener);
      visibilityListener = null;
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
