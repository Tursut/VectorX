// Step 16 — OnlineGameController routing tests.
//
// The controller has two halves: the outer wrapper (home / creating /
// join-screen states before a connection exists) and the inner OnlineRoom
// (which mounts useNetworkGame once we have a URL). We test the outer
// screen transitions here — the inner game rendering is covered end-to-end
// by Step 17's Playwright.
//
// useNetworkGame and fetch are both mocked so nothing touches a real
// socket/server.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock useNetworkGame BEFORE importing OnlineGameController.
vi.mock('../net/useNetworkGame.js', () => ({
  useNetworkGame: vi.fn(),
}));

import { useNetworkGame } from '../net/useNetworkGame.js';
import OnlineGameController from '../OnlineGameController.jsx';

// ---------- Harness ----------

beforeEach(() => {
  // Default: not connected; the outer screen handles this without touching
  // the room component. Tests that reach OnlineRoom override this.
  useNetworkGame.mockReturnValue({
    gameState: null,
    lobby: null,
    connectionState: 'connecting',
    mySeatId: null,
    lastError: null,
    join: vi.fn(),
    start: vi.fn(),
    move: vi.fn(),
  });
  global.fetch = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ---------- Outer screen: home / Create / Join ----------

describe('OnlineGameController — home screen', () => {
  it('renders Create Room and Join Room buttons + Menu back link', () => {
    render(<OnlineGameController onExit={() => {}} />);
    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument();
  });

  it('onExit fires when Menu is clicked', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<OnlineGameController onExit={onExit} />);
    await user.click(screen.getByRole('button', { name: /menu/i }));
    expect(onExit).toHaveBeenCalled();
  });
});

describe('OnlineGameController — Create Room flow', () => {
  it('POSTs /rooms and shows JoinScreen with the returned code pre-filled', async () => {
    const user = userEvent.setup();
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ code: 'Q7K4N' }),
    });

    render(<OnlineGameController onExit={() => {}} />);
    await user.click(screen.getByRole('button', { name: /create room/i }));

    // Room code is pre-filled in the code input once the POST resolves.
    await waitFor(() => {
      const code = screen.getByLabelText('Room code');
      expect(code.value).toBe('Q7K4N');
    });
  });

  it('surfaces an error when POST /rooms fails', async () => {
    const user = userEvent.setup();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });

    render(<OnlineGameController onExit={() => {}} />);
    await user.click(screen.getByRole('button', { name: /create room/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/500/);
    });
  });
});

describe('OnlineGameController — Join Room flow', () => {
  it('clicking Join Room shows a blank JoinScreen', async () => {
    const user = userEvent.setup();
    render(<OnlineGameController onExit={() => {}} />);
    await user.click(screen.getByRole('button', { name: /join room/i }));
    const code = screen.getByLabelText('Room code');
    expect(code.value).toBe('');
  });

  it('submitting JoinScreen transitions to the connected room', async () => {
    const user = userEvent.setup();
    render(<OnlineGameController onExit={() => {}} />);
    await user.click(screen.getByRole('button', { name: /join room/i }));

    await user.type(screen.getByLabelText('Room code'), 'Q7K4N');
    await user.type(
      screen.getByRole('textbox', { name: /your name/i }),
      'Alice',
    );
    await user.click(screen.getByRole('button', { name: /^join$/i }));

    // Now the inner OnlineRoom is mounted and useNetworkGame is called.
    await waitFor(() => {
      expect(useNetworkGame).toHaveBeenCalled();
    });
    // With connectionState='connecting', the room shows a status screen.
    expect(screen.getByText(/Connecting to room Q7K4N/i)).toBeInTheDocument();
  });

  it('Cancel on JoinScreen returns to the home screen', async () => {
    const user = userEvent.setup();
    render(<OnlineGameController onExit={() => {}} />);
    await user.click(screen.getByRole('button', { name: /join room/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
  });
});
