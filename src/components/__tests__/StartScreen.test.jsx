// StartScreen — mode switcher + online entry tests.
//
// Three modes: `this-device` (hotseat + bots slider), `create` (host a new
// online room: name input only), `join` (join someone else's room: name + code
// inputs). The switcher renders only when both online handlers are passed in.
// Joiners (join + valid code) get a stripped view — the Magic/Classic block,
// rules list, and footnote are all hidden.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StartScreen from '../StartScreen.jsx';

afterEach(cleanup);

const baseProps = {
  onStart: () => {},
  onSandbox: () => {},
  magicItems: true,
  onToggleMagicItems: () => {},
  gremlinCount: 3,
  onChangeGremlinCount: () => {},
  soundEnabled: true,
  onToggleSound: () => {},
};

function withOnline(extra = {}) {
  return {
    ...baseProps,
    onCreateOnline: () => {},
    onJoinOnline: () => {},
    ...extra,
  };
}

// ---------- Mode switcher visibility ----------

describe('StartScreen — mode switcher visibility', () => {
  it('hides the mode switcher when online handlers are not provided', () => {
    render(<StartScreen {...baseProps} />);
    expect(screen.queryByRole('tablist', { name: /game mode/i })).toBeNull();
  });

  it('renders three mode tiles when both online handlers are provided', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('tab', { name: /this device/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /create room/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /join room/i })).toBeInTheDocument();
  });

  it('defaults to This Device mode — bots slider visible, online inputs absent', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByText(/who's playing/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /your name/i })).toBeNull();
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });

  it('clicking Create Room shows the Name input only (no code field)', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /create room/i }));
    // AnimatePresence mode="wait" keeps the previous drawer mounted during its
    // exit animation; poll until the this-device drawer is actually gone.
    await waitFor(() => expect(screen.queryByText(/who's playing/i)).toBeNull());
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });

  it('clicking Join Room shows both Name and Code inputs', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /join room/i }));
    await waitFor(() => expect(screen.queryByText(/who's playing/i)).toBeNull());
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
  });
});

// ---------- Default mode (cold-open from share link) ----------

describe('StartScreen — defaultMode + defaultCode (cold-open)', () => {
  it('starts in Create mode when defaultMode="create"', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'create' })} />);
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    // In create mode there's no code input.
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });

  it('starts in Join mode when defaultMode="join"', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'join' })} />);
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
  });

  it('pre-fills the code input from defaultCode (uppercased + filtered)', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'join', defaultCode: 'abcde' })} />);
    expect(screen.getByLabelText(/room code/i).value).toBe('ABCDE');
  });
});

// ---------- Primary button label ----------

describe('StartScreen — primary button label', () => {
  it('is "START THE GAME" in This Device mode', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('button', { name: /start the game/i })).toBeInTheDocument();
  });

  it('is "CREATE ROOM" in Create mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /create room/i }));
    // Scope to the primary button bar to distinguish from the Create tab button.
    expect(
      screen.getByRole('button', { name: /create room →/i }),
    ).toBeInTheDocument();
  });

  it('is "JOIN ROOM" in Join mode with a valid code', () => {
    render(
      <StartScreen {...withOnline({ defaultMode: 'join', defaultCode: 'Q7K4N' })} />,
    );
    expect(
      screen.getByRole('button', { name: /join room →/i }),
    ).toBeInTheDocument();
  });
});

// ---------- Magic/Classic visibility for joiners ----------

describe('StartScreen — magic toggle visibility', () => {
  it('hides the entire Magic/Classic section for joiners (join + valid code)', () => {
    // Joiner view: defaultMode='join' + pre-filled code → stripped-down UI.
    render(
      <StartScreen {...withOnline({ defaultMode: 'join', defaultCode: 'Q7K4N' })} />,
    );
    // Button's accessible name prefixes the label with "✨ " / "⚔️ " from the
    // emoji span, so anchored regex won't match; unanchored is fine because
    // only these two buttons contain "magic" / "classic" on the joiner screen.
    expect(screen.queryByRole('button', { name: /magic/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /classic/i })).toBeNull();
  });

  it('shows the Magic/Classic toggle in Create mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /create room/i }));
    expect(
      await screen.findByRole('button', { name: /magic/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /classic/i })).toBeInTheDocument();
  });
});

// ---------- Submit gating + callbacks ----------

describe('StartScreen — online submit gating', () => {
  it('disables the primary button in Create mode until name is valid', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'create' })} />);
    const btn = screen.getByRole('button', { name: /create room →/i });
    expect(btn).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    expect(btn).not.toBeDisabled();
  });

  it('disables JOIN until both name and a 5-char code are filled', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'join' })} />);
    const btn = screen.getByRole('button', { name: /join room →/i });

    // Nothing filled — disabled.
    expect(btn).toBeDisabled();
    // Name only — still disabled (code missing).
    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    expect(btn).toBeDisabled();
    // Code only 3 chars — still disabled.
    await user.type(screen.getByLabelText(/room code/i), 'ABC');
    expect(btn).toBeDisabled();
    // Fifth char → enabled.
    await user.type(screen.getByLabelText(/room code/i), 'DE');
    expect(btn).not.toBeDisabled();
  });
});

describe('StartScreen — online callbacks', () => {
  it('calls onCreateOnline with trimmed name + current magic setting', async () => {
    const user = userEvent.setup();
    const onCreateOnline = vi.fn();
    render(
      <StartScreen
        {...withOnline({
          onCreateOnline,
          defaultMode: 'create',
          magicItems: true,
        })}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: /your name/i }), '  Alice  ');
    await user.click(screen.getByRole('button', { name: /create room →/i }));
    expect(onCreateOnline).toHaveBeenCalledWith({
      displayName: 'Alice',
      magicItems: true,
    });
  });

  it('calls onJoinOnline with trimmed name + code', async () => {
    const user = userEvent.setup();
    const onJoinOnline = vi.fn();
    render(
      <StartScreen
        {...withOnline({ onJoinOnline, defaultMode: 'join' })}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    await user.type(screen.getByLabelText(/room code/i), 'Q7K4N');
    await user.click(screen.getByRole('button', { name: /join room →/i }));
    expect(onJoinOnline).toHaveBeenCalledWith({
      displayName: 'Alice',
      code: 'Q7K4N',
    });
  });
});

// ---------- URL paste extraction ----------

describe('StartScreen — code paste', () => {
  it('extracts a code from a pasted share link in Join mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'join' })} />);
    const code = screen.getByLabelText(/room code/i);
    code.focus();
    await user.paste('https://example.com/VectorX/#/r/Q7K4N');
    expect(code.value).toBe('Q7K4N');
  });
});

// ---------- Testing ground visibility ----------

describe('StartScreen — testing ground link', () => {
  it('shows the testing-ground link in This Device mode', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('button', { name: /testing ground/i })).toBeInTheDocument();
  });

  it('hides the testing-ground link in Create mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /create room/i }));
    expect(screen.queryByRole('button', { name: /testing ground/i })).toBeNull();
  });

  it('hides the testing-ground link in Join mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /join room/i }));
    expect(screen.queryByRole('button', { name: /testing ground/i })).toBeNull();
  });
});

// ---------- Online error surfacing ----------

describe('StartScreen — onlineError', () => {
  it('renders onlineError in Create mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ onlineError: 'Server returned 500' })} />);
    await user.click(screen.getByRole('tab', { name: /create room/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/500/);
  });
});
