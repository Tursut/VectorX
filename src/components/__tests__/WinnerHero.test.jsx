import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../game/sounds', () => ({
  playWin: vi.fn(),
}));

import WinnerHero from '../WinnerHero';
import * as sounds from '../../game/sounds';

const winner = {
  id: 0,
  color: '#e74c3c',
  icon: '🧙',
  name: 'Wizard',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('WinnerHero', () => {
  it('renders hero content when winner is present', () => {
    render(<WinnerHero winner={winner} onContinue={() => {}} soundKey="g1" />);
    expect(screen.getByRole('heading', { name: 'WINNER!' })).toBeInTheDocument();
    expect(screen.getByText('TAP TO CONTINUE')).toBeInTheDocument();
    // Sound fires after the macrotask (setTimeout 0).
    expect(sounds.playWin).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(0));
    expect(sounds.playWin).toHaveBeenCalledOnce();
  });

  it('renders nothing and plays no sound when winner is missing', () => {
    render(<WinnerHero winner={null} onContinue={() => {}} soundKey="g2" />);
    act(() => vi.advanceTimersByTime(0));
    expect(screen.queryByRole('heading', { name: 'WINNER!' })).not.toBeInTheDocument();
    expect(sounds.playWin).not.toHaveBeenCalled();
  });

  it('cancels sound if unmounted before the macrotask fires', () => {
    const { unmount } = render(<WinnerHero winner={winner} onContinue={() => {}} soundKey="g3" />);
    unmount();
    act(() => vi.advanceTimersByTime(0));
    expect(sounds.playWin).not.toHaveBeenCalled();
  });

  it('fires handoff callbacks around fanfare start', () => {
    const onBeforeFanfare = vi.fn();
    const onAfterFanfareStart = vi.fn();
    render(
      <WinnerHero
        winner={winner}
        onContinue={() => {}}
        soundKey="g4"
        onBeforeFanfare={onBeforeFanfare}
        onAfterFanfareStart={onAfterFanfareStart}
      />,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(onBeforeFanfare).toHaveBeenCalledOnce();
    expect(sounds.playWin).toHaveBeenCalledOnce();
    expect(onAfterFanfareStart).toHaveBeenCalledOnce();
  });

});
