// Step 15 — Lobby unit tests. Pure presentational coverage.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Lobby from '../Lobby.jsx';

afterEach(cleanup);

const fourPlayers = [
  { id: 0, displayName: 'Alice', isBot: false, isHost: true },
  { id: 1, displayName: 'Bob', isBot: false, isHost: false },
  { id: 2, displayName: 'Cat', isBot: false, isHost: false },
  { id: 3, displayName: 'Dan', isBot: false, isHost: false },
];

describe('Lobby — rendering', () => {
  it('shows the room code with CODE prefix', () => {
    render(<Lobby code="Q7K4N" players={[]} hostId={null} mySeatId={null} />);
    expect(screen.getByTestId('lobby-code')).toHaveTextContent('CODE: Q7K4N');
  });

  it('shows the Room link section label', () => {
    render(<Lobby code="Q7K4N" players={[]} hostId={null} mySeatId={null} />);
    expect(screen.getByText('Room link')).toBeInTheDocument();
  });

  it('uses host explainer copy when viewer is host', () => {
    render(<Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={0} />);
    expect(screen.getByText(/hit start/)).toBeInTheDocument();
    expect(screen.queryByText(/started by the host/)).toBeNull();
  });

  it('uses joiner explainer copy when viewer is not host', () => {
    render(<Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={1} />);
    expect(screen.getByText(/started by the host/)).toBeInTheDocument();
    expect(screen.queryByText(/hit start/)).toBeNull();
  });

  it('renders each player by displayName', () => {
    render(<Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={0} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Cat')).toBeInTheDocument();
    expect(screen.getByText('Dan')).toBeInTheDocument();
  });

  it('shows a host badge next to the host', () => {
    render(<Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={0} />);
    expect(screen.getByLabelText('host')).toBeInTheDocument();
  });

  it('shows "(you)" next to mySeatId', () => {
    render(<Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={2} />);
    const youBadge = screen.getByText(/\(you\)/);
    expect(youBadge).toBeInTheDocument();
    // The "you" badge lives inside Cat's list item.
    const items = screen.getAllByRole('listitem');
    const cat = items.find((li) => li.textContent.includes('Cat'));
    expect(cat).toContain(youBadge);
  });

  it('renders empty-seat placeholders for missing seats', () => {
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers.slice(0, 2)}
        hostId={0}
        mySeatId={0}
      />,
    );
    const bots = screen.getAllByText(/Bot will fill this slot/);
    expect(bots).toHaveLength(2);
  });

  it('renders an avatar for every player and empty seat', () => {
    const { container } = render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers.slice(0, 2)}
        hostId={0}
        mySeatId={0}
      />,
    );
    expect(container.querySelectorAll('.lobby-player-avatar')).toHaveLength(4);
    expect(container.querySelectorAll('.lobby-player-avatar-bot')).toHaveLength(2);
  });

  it('renders sound toggle when sound props are provided', () => {
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers}
        hostId={0}
        mySeatId={0}
        soundEnabled
        onToggleSound={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /mute/i })).toBeInTheDocument();
  });

  it('clicking sound toggle fires onToggleSound', async () => {
    const user = userEvent.setup();
    const onToggleSound = vi.fn();
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers}
        hostId={0}
        mySeatId={0}
        soundEnabled
        onToggleSound={onToggleSound}
      />,
    );
    await user.click(screen.getByRole('button', { name: /mute/i }));
    expect(onToggleSound).toHaveBeenCalledTimes(1);
  });
});

describe('Lobby — host-only controls', () => {
  it('renders Start button only when mySeatId === hostId', () => {
    render(<Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={0} />);
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('hides host controls for a non-host seat', () => {
    const { container } = render(
      <Lobby code="Q7K4N" players={fourPlayers} hostId={0} mySeatId={1} />,
    );
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull();
    const wait = screen.getByText(/Waiting for the host to start/);
    expect(wait).toBeInTheDocument();
    expect(wait).toHaveClass('lobby-wait-note--prominent');
    const list = container.querySelector('.lobby-players');
    expect(list).toBeTruthy();
    expect(
      wait.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('clicking Start fires onStart', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers}
        hostId={0}
        mySeatId={0}
        onStart={onStart}
      />,
    );
    await user.click(screen.getByRole('button', { name: /start/i }));
    expect(onStart).toHaveBeenCalled();
  });

  it('shows Magic/Classic for host when onMagicItemsChange is provided', () => {
    const onMagicItemsChange = vi.fn();
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers}
        hostId={0}
        mySeatId={0}
        magicItems={false}
        onMagicItemsChange={onMagicItemsChange}
      />,
    );
    expect(screen.getByRole('button', { name: /magic/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /classic/i })).toBeInTheDocument();
  });

  it('hides Magic/Classic for non-host even with onMagicItemsChange', () => {
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers}
        hostId={0}
        mySeatId={1}
        magicItems={false}
        onMagicItemsChange={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /magic/i })).toBeNull();
  });

});

describe('Lobby — leave', () => {
  it('renders Leave button when onLeave is provided and fires callback', async () => {
    const user = userEvent.setup();
    const onLeave = vi.fn();
    render(
      <Lobby
        code="Q7K4N"
        players={fourPlayers}
        hostId={0}
        mySeatId={0}
        onLeave={onLeave}
      />,
    );
    await user.click(screen.getByRole('button', { name: /exit to menu/i }));
    expect(onLeave).toHaveBeenCalled();
  });
});
