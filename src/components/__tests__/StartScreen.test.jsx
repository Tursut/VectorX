// StartScreen — mode switcher + online entry tests.
//
// The merged screen has two modes ("Same device" / "Online"). The switcher
// appears only when online handlers are provided (i.e. ENABLE_ONLINE=true
// at build time). In online mode the "Who's playing?" bots slider is
// replaced by Name + Code inputs, and the primary button's label flips
// between CREATE ROOM (empty code) and JOIN ROOM (valid code).

import { cleanup, render, screen } from '@testing-library/react';
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

// Helpers for the online online-handlers pair.
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

  it('renders the mode switcher when both online handlers are provided', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('tab', { name: /same device/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /online/i })).toBeInTheDocument();
  });

  it('defaults to Same device mode — bots slider visible, online inputs absent', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByText(/who's playing/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /your name/i })).toBeNull();
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });

  it('clicking the Online tile hides "Who\'s playing?" and shows Name + Code inputs', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /online/i }));
    expect(screen.queryByText(/who's playing/i)).toBeNull();
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
  });
});

// ---------- Default mode (cold-open from share link) ----------

describe('StartScreen — defaultMode + defaultCode (cold-open)', () => {
  it('starts in Online mode when defaultMode="online"', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'online' })} />);
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
  });

  it('pre-fills the code input from defaultCode (uppercased + filtered)', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'online', defaultCode: 'abcde' })} />);
    expect(screen.getByLabelText(/room code/i).value).toBe('ABCDE');
  });
});

// ---------- Primary button label ----------

describe('StartScreen — primary button label', () => {
  it('is "START THE GAME" in Same device mode', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('button', { name: /start the game/i })).toBeInTheDocument();
  });

  it('is "CREATE ROOM" in Online mode with empty code', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /online/i }));
    expect(screen.getByRole('button', { name: /create room/i })).toBeInTheDocument();
  });

  it('is "JOIN ROOM" in Online mode with a valid code', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'online', defaultCode: 'Q7K4N' })} />);
    expect(screen.getByRole('button', { name: /join room/i })).toBeInTheDocument();
  });
});

// ---------- Magic/Classic visibility for joiners ----------

describe('StartScreen — magic toggle visibility', () => {
  it('hides Magic/Classic toggle when online + code is filled (joiner)', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'online' })} />);
    await user.type(screen.getByLabelText(/room code/i), 'Q7K4N');
    expect(screen.queryByRole('button', { name: /^classic$/i })).toBeNull();
    expect(screen.getByText(/host picks magic items/i)).toBeInTheDocument();
  });

  it('shows Magic/Classic toggle when online + code is empty (creator)', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /online/i }));
    expect(screen.getByRole('button', { name: /magic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /classic/i })).toBeInTheDocument();
  });
});

// ---------- Submit gating + callbacks ----------

describe('StartScreen — online submit gating', () => {
  it('disables the primary button until name is valid', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /online/i }));
    const btn = screen.getByRole('button', { name: /create room/i });
    expect(btn).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    expect(btn).not.toBeDisabled();
  });

  it('disables JOIN until code reaches 5 alphabet chars', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'online' })} />);
    const btn = screen.getByRole('button', { name: /create room|join room/i });
    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    // With no code the button is CREATE ROOM and enabled.
    expect(screen.getByRole('button', { name: /create room/i })).not.toBeDisabled();
    // Type only 3 chars → code is not-empty-not-valid → submit disabled.
    await user.type(screen.getByLabelText(/room code/i), 'ABC');
    expect(btn).toBeDisabled();
    // Two more alphabet chars → valid → submit enabled as JOIN ROOM.
    await user.type(screen.getByLabelText(/room code/i), 'DE');
    expect(screen.getByRole('button', { name: /join room/i })).not.toBeDisabled();
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
          defaultMode: 'online',
          magicItems: true,
        })}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: /your name/i }), '  Alice  ');
    await user.click(screen.getByRole('button', { name: /create room/i }));
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
        {...withOnline({ onJoinOnline, defaultMode: 'online' })}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Alice');
    await user.type(screen.getByLabelText(/room code/i), 'Q7K4N');
    await user.click(screen.getByRole('button', { name: /join room/i }));
    expect(onJoinOnline).toHaveBeenCalledWith({
      displayName: 'Alice',
      code: 'Q7K4N',
    });
  });
});

// ---------- URL paste extraction ----------

describe('StartScreen — code paste', () => {
  it('extracts a code from a pasted share link in Online mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'online' })} />);
    const code = screen.getByLabelText(/room code/i);
    code.focus();
    await user.paste('https://example.com/VectorX/#/r/Q7K4N');
    expect(code.value).toBe('Q7K4N');
  });
});

// ---------- Testing ground visibility ----------

describe('StartScreen — testing ground link', () => {
  it('shows the testing-ground link in Same device mode', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('button', { name: /testing ground/i })).toBeInTheDocument();
  });

  it('hides the testing-ground link in Online mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByRole('tab', { name: /online/i }));
    expect(screen.queryByRole('button', { name: /testing ground/i })).toBeNull();
  });
});

// ---------- Online error surfacing ----------

describe('StartScreen — onlineError', () => {
  it('renders onlineError in Online mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ onlineError: 'Server returned 500' })} />);
    await user.click(screen.getByRole('tab', { name: /online/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/500/);
  });
});
