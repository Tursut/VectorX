import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../config', () => ({
  ENABLE_ONLINE: true,
  SERVER_URL: 'https://test.server',
}));
vi.mock('../LocalGameController', () => ({
  default: ({ onCreateOnline }) => (
    <div data-testid="local-controller">
      <button
        type="button"
        data-testid="create-online-trigger"
        onClick={() => onCreateOnline?.({ displayName: 'Alice', magicItems: true })}
      >
        Create room
      </button>
    </div>
  ),
}));
vi.mock('../OnlineGameController', () => ({
  default: ({ onReady }) => (
    <div data-testid="online-controller">
      <button type="button" data-testid="online-ready-trigger" onClick={() => onReady?.()}>
        Ready
      </button>
    </div>
  ),
}));

import App from '../App';

describe('App mode router', () => {
  beforeEach(() => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ code: 'ABCDE' }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders LocalGameController by default', () => {
    render(<App />);
    expect(screen.getByTestId('local-controller')).toBeInTheDocument();
    expect(screen.queryByTestId('online-controller')).not.toBeInTheDocument();
  });

  it('keeps waiting flourish visible until online controller reports ready', async () => {
    render(<App />);

    fireEvent.click(screen.getByTestId('create-online-trigger'));

    expect(await screen.findByRole('status')).toHaveTextContent(/creating private room/i);
    expect(await screen.findByTestId('online-controller')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('online-ready-trigger'));
    expect(screen.getByRole('status')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    }, { timeout: 4000 });
  });
});
