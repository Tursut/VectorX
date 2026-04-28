// StartScreen — three-view IA: menu (PLAY + PLAY WITH FRIENDS heroes),
// online (multiplayer drawer with name + create/join sub-state), local
// (hotseat slider). Cold-open share-link + retry-after-rejection skip
// the menu and land directly in the online view in join mode. Joiners
// (online + join + valid code) get a stripped view — the Magic/Classic
// block, the create/join toggle, and the rules list all hide.

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

// ---------- Menu view ----------

describe('StartScreen — menu view (online available)', () => {
  it('renders PLAY + PLAY WITH FRIENDS hero buttons + pass-and-play link', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByTestId('hero-play')).toBeInTheDocument();
    expect(screen.getByTestId('hero-play-online')).toBeInTheDocument();
    expect(screen.getByTestId('hero-pass-and-play')).toBeInTheDocument();
  });

  it('clicking PLAY calls onStart immediately (no name input, no toggles)', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<StartScreen {...withOnline({ onStart })} />);
    await user.click(screen.getByTestId('hero-play'));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('clicking PLAY WITH FRIENDS opens the online view in create mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
    expect(screen.getByRole('button', { name: /create room →/i })).toBeInTheDocument();
  });

  it('clicking pass-and-play opens the local hotseat view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-pass-and-play'));
    await waitFor(() =>
      expect(screen.getByText(/who's playing/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /start the game/i })).toBeInTheDocument();
  });

  it('hides the PLAY WITH FRIENDS button when online is unavailable', () => {
    render(<StartScreen {...baseProps} />);
    // Offline build skips the menu and lands directly in the local view.
    expect(screen.queryByTestId('hero-play-online')).toBeNull();
    expect(screen.getByText(/who's playing/i)).toBeInTheDocument();
  });
});

// ---------- Online view: create + join sub-states ----------

describe('StartScreen — online view sub-states', () => {
  it('starts in create state by default — name only, no code', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
    expect(screen.getByRole('button', { name: /create room →/i })).toBeInTheDocument();
  });

  it('the "got a code?" toggle flips to join state — code field appears, primary becomes JOIN', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    const toggle = await screen.findByTestId('toggle-join-mode');
    await user.click(toggle);
    expect(await screen.findByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join room →/i })).toBeInTheDocument();
  });

  it('the toggle flips back to create — "host a new room" copy on it', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    const toggle = await screen.findByTestId('toggle-join-mode');
    await user.click(toggle);
    expect(screen.getByTestId('toggle-join-mode')).toHaveTextContent(/host a new room/i);
    await user.click(screen.getByTestId('toggle-join-mode'));
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
  });

  it('"Back to menu" returns to the menu view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    const back = await screen.findByRole('button', { name: /back to menu/i });
    await user.click(back);
    await waitFor(() => expect(screen.getByTestId('hero-play')).toBeInTheDocument());
  });
});

// ---------- Cold-open (share link / retry-after-rejection) ----------

describe('StartScreen — defaultMode + defaultCode (cold-open)', () => {
  it('starts in online/create when defaultMode="create"', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'create' })} />);
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/room code/i)).toBeNull();
    expect(screen.queryByTestId('hero-play')).toBeNull();
  });

  it('starts in online/join when defaultMode="join"', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'join' })} />);
    expect(screen.getByRole('textbox', { name: /your name/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/room code/i)).toBeInTheDocument();
    expect(screen.queryByTestId('hero-play')).toBeNull();
  });

  it('pre-fills the code input from defaultCode (uppercased + filtered)', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'join', defaultCode: 'abcde' })} />);
    expect(screen.getByLabelText(/room code/i).value).toBe('ABCDE');
  });

  it('pre-fills the name input from defaultDisplayName (retry flow)', () => {
    render(
      <StartScreen
        {...withOnline({
          defaultMode: 'join',
          defaultCode: 'Q7K4N',
          defaultDisplayName: 'Bob',
        })}
      />,
    );
    expect(screen.getByRole('textbox', { name: /your name/i }).value).toBe('Bob');
  });
});

// ---------- Primary button label ----------

describe('StartScreen — primary button label', () => {
  it('is "START THE GAME" in local view (after pass-and-play)', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-pass-and-play'));
    expect(screen.getByRole('button', { name: /start the game/i })).toBeInTheDocument();
  });

  it('is "CREATE ROOM" in online/create view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    expect(screen.getByRole('button', { name: /create room →/i })).toBeInTheDocument();
  });

  it('is "JOIN ROOM" in online/join view with a valid code', () => {
    render(
      <StartScreen {...withOnline({ defaultMode: 'join', defaultCode: 'Q7K4N' })} />,
    );
    expect(screen.getByRole('button', { name: /join room →/i })).toBeInTheDocument();
  });

  it('does NOT render a primary bottom-bar button on the menu view', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.queryByTestId('primary-button')).toBeNull();
  });
});

// ---------- Magic/Classic visibility ----------

describe('StartScreen — magic toggle visibility', () => {
  it('hides the entire Magic/Classic section for joiners (online/join + valid code)', () => {
    render(
      <StartScreen {...withOnline({ defaultMode: 'join', defaultCode: 'Q7K4N' })} />,
    );
    expect(screen.queryByRole('button', { name: /magic/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /classic/i })).toBeNull();
  });

  it('hides Magic/Classic on the menu view (no per-mode picker until you commit to a mode)', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.queryByRole('button', { name: /^✨ magic/i })).toBeNull();
  });

  it('shows Magic/Classic in online/create view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    expect(await screen.findByRole('button', { name: /magic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /classic/i })).toBeInTheDocument();
  });

  it('shows Magic/Classic in local view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-pass-and-play'));
    expect(await screen.findByRole('button', { name: /magic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /classic/i })).toBeInTheDocument();
  });
});

// ---------- Submit gating + callbacks ----------

describe('StartScreen — online submit gating', () => {
  it('does not call onCreateOnline when name is empty; surfaces a name error', async () => {
    const user = userEvent.setup();
    const onCreateOnline = vi.fn();
    render(<StartScreen {...withOnline({ defaultMode: 'create', onCreateOnline })} />);
    const btn = screen.getByRole('button', { name: /create room →/i });
    const nameInput = screen.getByRole('textbox', { name: /your name/i });

    await user.clear(nameInput);
    await user.click(btn);
    expect(onCreateOnline).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your name/i);

    await user.type(nameInput, 'Alice');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(btn);
    expect(onCreateOnline).toHaveBeenCalledOnce();
  });

  it('JOIN surfaces a name error first, then a code error, before submitting', async () => {
    const user = userEvent.setup();
    const onJoinOnline = vi.fn();
    render(<StartScreen {...withOnline({ defaultMode: 'join', onJoinOnline })} />);
    const btn = screen.getByRole('button', { name: /join room →/i });
    const nameInput = screen.getByRole('textbox', { name: /your name/i });

    await user.clear(nameInput);
    await user.click(btn);
    expect(onJoinOnline).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/enter your name/i);

    await user.type(nameInput, 'Alice');
    await user.click(btn);
    expect(onJoinOnline).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/room code/i);

    await user.type(screen.getByLabelText(/room code/i), 'ABC');
    await user.click(btn);
    expect(onJoinOnline).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/room code/i), 'DE');
    await user.click(btn);
    expect(onJoinOnline).toHaveBeenCalledOnce();
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
    const nameInput = screen.getByRole('textbox', { name: /your name/i });
    await user.clear(nameInput);
    await user.type(nameInput, '  Alice  ');
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
    const nameInput = screen.getByRole('textbox', { name: /your name/i });
    await user.clear(nameInput);
    await user.type(nameInput, 'Alice');
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
  it('extracts a code from a pasted share link in join mode', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ defaultMode: 'join' })} />);
    const code = screen.getByLabelText(/room code/i);
    code.focus();
    await user.paste('https://example.com/VectorX/#/r/Q7K4N');
    expect(code.value).toBe('Q7K4N');
  });
});

// ---------- Testing ground link visibility ----------

describe('StartScreen — testing ground link', () => {
  it('shows the testing-ground link on the menu view', () => {
    render(<StartScreen {...withOnline()} />);
    expect(screen.getByRole('button', { name: /testing ground/i })).toBeInTheDocument();
  });

  it('hides the testing-ground link in the online view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-play-online'));
    expect(screen.queryByRole('button', { name: /testing ground/i })).toBeNull();
  });

  it('hides the testing-ground link in the local view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline()} />);
    await user.click(screen.getByTestId('hero-pass-and-play'));
    expect(screen.queryByRole('button', { name: /testing ground/i })).toBeNull();
  });
});

// ---------- Waiting flourish (issue #45) ----------
//
// StartScreen renders the flourish when its creatingRoom prop is
// true, no minimum-display logic of its own. The minimum lives
// in App.jsx (it has to — setOnline unmounts StartScreen, so
// local sticky state can't outlive that transition).

describe('StartScreen — creatingRoom waiting flourish', () => {
  it('shows the flourish (with the playground heading) when creatingRoom is true', () => {
    render(
      <StartScreen
        {...withOnline({ defaultMode: 'create', creatingRoom: true })}
      />,
    );
    expect(screen.queryByTestId('primary-button')).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/creating your playground/i)).toBeInTheDocument();
  });

  it('shows the primary button when creatingRoom is false', () => {
    render(<StartScreen {...withOnline({ defaultMode: 'create' })} />);
    expect(screen.getByTestId('primary-button')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ---------- Online error surfacing ----------

describe('StartScreen — onlineError', () => {
  it('renders onlineError in online/create view', async () => {
    const user = userEvent.setup();
    render(<StartScreen {...withOnline({ onlineError: 'Server returned 500' })} />);
    await user.click(screen.getByTestId('hero-play-online'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/500/);
  });
});
