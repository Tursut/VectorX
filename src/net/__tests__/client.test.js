// Step 13 — client.js wrapper tests.
//
// Uses a hand-written MockWebSocket installed via vi.stubGlobal. Tests cover:
//   - connect + onStateChange transitions
//   - inbound message validation (happy path, malformed JSON, wrong shape)
//   - outbound validation (ClientMsg.parse throws on garbage)
//   - send queue: buffered before OPEN, flushed on OPEN, resilient through
//     a reconnect cycle
//   - auto-reconnect: unexpected close schedules a reconnect; backoff grows
//     on repeated failures; explicit close() never reconnects
//
// Backoff is driven by real setTimeout, so we use vi.useFakeTimers() to
// advance time deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../client.js';

// ---------- MockWebSocket ----------

const OPEN_SOCKETS = [];

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.listeners = { open: [], message: [], close: [], error: [] };
    this.sentFrames = [];
    this.closedWithCode = null;
    OPEN_SOCKETS.push(this);
  }

  addEventListener(type, fn) {
    this.listeners[type]?.push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error(`MockWebSocket.send while readyState=${this.readyState}`);
    }
    this.sentFrames.push(data);
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSING;
    this.closedWithCode = code;
    // Defer the close event to the next microtask, mirroring browser behaviour.
    queueMicrotask(() => this._fireClose(code, 'client-close'));
  }

  // Test-side helpers — not part of the browser API.
  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    for (const fn of this.listeners.open) fn({});
  }
  _simulateMessage(data) {
    for (const fn of this.listeners.message) fn({ data });
  }
  _simulateClose(code = 1006, reason = 'unexpected') {
    this._fireClose(code, reason);
  }
  _fireClose(code, reason) {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    for (const fn of this.listeners.close) fn({ code, reason });
  }
  _simulateError() {
    for (const fn of this.listeners.error) fn({});
  }
}

// ---------- Harness ----------

beforeEach(() => {
  OPEN_SOCKETS.length = 0;
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Grab the most recent MockWebSocket instance.
function latestSocket() {
  return OPEN_SOCKETS[OPEN_SOCKETS.length - 1];
}

// Drive queueMicrotask promises to completion inside the fake-timers loop.
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------- Cases ----------

describe('createClient — connect + state transitions', () => {
  it('opens a socket to the provided url and transitions connecting → open', () => {
    const onStateChange = vi.fn();
    const client = createClient({
      url: 'ws://example/rooms/ABCDE/ws',
      onStateChange,
    });

    expect(latestSocket().url).toBe('ws://example/rooms/ABCDE/ws');
    // First transition to connecting happens synchronously during connect()
    expect(onStateChange).toHaveBeenCalledWith('connecting');

    latestSocket()._simulateOpen();
    expect(onStateChange).toHaveBeenCalledWith('open');
    expect(client.getState()).toBe('open');
  });

  it('throws if no url is provided', () => {
    expect(() => createClient({})).toThrow(/url is required/);
  });
});

describe('createClient — inbound message validation', () => {
  it('calls onMessage with a zod-validated ServerMsg', () => {
    const onMessage = vi.fn();
    createClient({ url: 'ws://x/y', onMessage });
    latestSocket()._simulateOpen();

    latestSocket()._simulateMessage(JSON.stringify({
      type: 'JOIN',
      player: { id: 0, displayName: 'Alice', isBot: false, isHost: true },
    }));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage.mock.calls[0][0]).toMatchObject({ type: 'JOIN' });
  });

  it('drops non-JSON frames without crashing', () => {
    const onMessage = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createClient({ url: 'ws://x/y', onMessage });
    latestSocket()._simulateOpen();

    latestSocket()._simulateMessage('not json');
    expect(onMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops valid-JSON-but-malformed-ServerMsg frames', () => {
    const onMessage = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createClient({ url: 'ws://x/y', onMessage });
    latestSocket()._simulateOpen();

    latestSocket()._simulateMessage(JSON.stringify({ type: 'NOT_A_TYPE' }));
    expect(onMessage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('createClient — send validation and queue', () => {
  it('sends immediately when socket is OPEN', () => {
    const client = createClient({ url: 'ws://x/y' });
    latestSocket()._simulateOpen();

    client.send({ type: 'MOVE', row: 0, col: 1 });
    expect(latestSocket().sentFrames).toEqual([
      JSON.stringify({ type: 'MOVE', row: 0, col: 1 }),
    ]);
  });

  it('queues sends before OPEN and flushes them in FIFO order on OPEN', () => {
    const client = createClient({ url: 'ws://x/y' });
    client.send({ type: 'HELLO', version: 1, displayName: 'Alice' });
    client.send({ type: 'MOVE', row: 0, col: 1 });

    // Socket hasn't opened yet; nothing sent.
    expect(latestSocket().sentFrames).toEqual([]);

    latestSocket()._simulateOpen();
    expect(latestSocket().sentFrames).toEqual([
      JSON.stringify({ type: 'HELLO', version: 1, displayName: 'Alice' }),
      JSON.stringify({ type: 'MOVE', row: 0, col: 1 }),
    ]);
  });

  it('throws synchronously if send() is called with a malformed ClientMsg', () => {
    const client = createClient({ url: 'ws://x/y' });
    latestSocket()._simulateOpen();

    // Missing `version` on HELLO.
    expect(() => client.send({ type: 'HELLO', displayName: 'Alice' })).toThrow();
    // And unknown type.
    expect(() => client.send({ type: 'BOGUS' })).toThrow();
  });
});

describe('createClient — auto-reconnect with backoff', () => {
  it('schedules a reconnect after an unexpected close', async () => {
    const onStateChange = vi.fn();
    createClient({ url: 'ws://x/y', onStateChange });
    latestSocket()._simulateOpen();

    const before = OPEN_SOCKETS.length;
    latestSocket()._simulateClose(1006, 'unexpected');
    expect(onStateChange).toHaveBeenCalledWith('closed');

    // Advance past the first backoff step (500ms ± 25% jitter → ≤ 625ms).
    vi.advanceTimersByTime(700);
    await flushMicrotasks();

    expect(OPEN_SOCKETS.length).toBe(before + 1);
    expect(onStateChange).toHaveBeenCalledWith('connecting');
  });

  it('grows the backoff on repeated immediate failures', async () => {
    createClient({ url: 'ws://x/y' });

    // First open, then unexpected close.
    latestSocket()._simulateOpen();
    latestSocket()._simulateClose(1006);

    // 500ms ± 25% → reconnect attempt 1 starts.
    vi.advanceTimersByTime(700);
    await flushMicrotasks();
    const afterAttempt1 = OPEN_SOCKETS.length;

    // Close again before it opens.
    latestSocket()._simulateClose(1006);
    // Attempt 2 backoff is 1000ms ± 25% → ≤ 1250ms. Make sure 700ms alone
    // isn't enough (backoff grew).
    vi.advanceTimersByTime(700);
    await flushMicrotasks();
    expect(OPEN_SOCKETS.length).toBe(afterAttempt1); // still waiting

    vi.advanceTimersByTime(600);
    await flushMicrotasks();
    expect(OPEN_SOCKETS.length).toBe(afterAttempt1 + 1);
  });

  it('resets backoff after a successful open', async () => {
    createClient({ url: 'ws://x/y' });

    latestSocket()._simulateOpen();
    latestSocket()._simulateClose(1006);
    vi.advanceTimersByTime(700);
    await flushMicrotasks();

    // Reconnect attempt 1 now OPENS successfully → attempts reset to 0.
    latestSocket()._simulateOpen();
    latestSocket()._simulateClose(1006);

    // Next reconnect should again be in the initial ~500ms window.
    vi.advanceTimersByTime(700);
    await flushMicrotasks();

    // The fact that advancing 700ms was enough proves backoff reset.
    // If it hadn't reset, attempt 3's delay (2000ms) would have left
    // OPEN_SOCKETS at its prior count.
    const countNow = OPEN_SOCKETS.length;
    expect(countNow).toBeGreaterThanOrEqual(3);
  });

  it('flushes the queue after a reconnect', async () => {
    const client = createClient({ url: 'ws://x/y' });

    latestSocket()._simulateOpen();
    client.send({ type: 'HELLO', version: 1, displayName: 'Alice' });

    latestSocket()._simulateClose(1006);

    // Queue a send while disconnected.
    client.send({ type: 'MOVE', row: 0, col: 1 });

    vi.advanceTimersByTime(700);
    await flushMicrotasks();

    const reconnected = latestSocket();
    expect(reconnected.sentFrames).toEqual([]);

    reconnected._simulateOpen();
    expect(reconnected.sentFrames).toEqual([
      JSON.stringify({ type: 'MOVE', row: 0, col: 1 }),
    ]);
    // HELLO from the pre-close session was already flushed on the first OPEN.
  });
});

describe('createClient — explicit close()', () => {
  it('does NOT reconnect after an explicit close', async () => {
    const client = createClient({ url: 'ws://x/y' });
    latestSocket()._simulateOpen();

    const before = OPEN_SOCKETS.length;
    client.close();
    await flushMicrotasks();

    vi.advanceTimersByTime(60_000);
    await flushMicrotasks();

    expect(OPEN_SOCKETS.length).toBe(before);
    expect(client.getState()).toBe('destroyed');
  });

  it('is idempotent', () => {
    const client = createClient({ url: 'ws://x/y' });
    latestSocket()._simulateOpen();
    client.close();
    expect(() => client.close()).not.toThrow();
    expect(client.getState()).toBe('destroyed');
  });
});
