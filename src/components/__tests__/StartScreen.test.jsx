// StartScreen — online-entry button visibility (Step 16).
//
// The existing hotseat controls have been tested via manual playthrough for
// years; Step 16 adds a new affordance — "Play online" — that is gated on
// `onGoOnline` being provided by the parent. When the prop is null/undefined
// (ENABLE_ONLINE=false), the button must not render.

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

describe('StartScreen — online-entry button', () => {
  it('does NOT render the Play online button when onGoOnline is not provided', () => {
    render(<StartScreen {...baseProps} />);
    expect(
      screen.queryByRole('button', { name: /play online/i }),
    ).toBeNull();
  });

  it('renders the Play online button when onGoOnline is a function', () => {
    const onGoOnline = () => {};
    render(<StartScreen {...baseProps} onGoOnline={onGoOnline} />);
    expect(
      screen.getByRole('button', { name: /play online/i }),
    ).toBeInTheDocument();
  });

  it('calls onGoOnline when the Play online button is clicked', async () => {
    const user = userEvent.setup();
    const onGoOnline = vi.fn();
    render(<StartScreen {...baseProps} onGoOnline={onGoOnline} />);
    await user.click(screen.getByRole('button', { name: /play online/i }));
    expect(onGoOnline).toHaveBeenCalled();
  });
});
