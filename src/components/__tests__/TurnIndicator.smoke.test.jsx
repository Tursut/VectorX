// Smoke test — renders TurnIndicator and confirms the bot's avatar emoji
// shows up. Used to investigate the "avatar is gone for bots" report; if
// the emoji renders here, the bug is environmental (CSS, screen capture,
// emoji font availability) rather than a JS-level missing-icon issue.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import TurnIndicator from '../TurnIndicator';
import { PLAYERS } from '../../game/constants';

describe('TurnIndicator — bot avatar smoke', () => {
  it('renders the player.icon in the turn-icon container when isThinking=false', () => {
    const player = { ...PLAYERS[3], name: PLAYERS[3].name }; // Buzzilda, the bee
    const { container } = render(
      <TurnIndicator
        player={player}
        taunt="Pretend taunt"
        timeLeft={9}
        totalTime={10}
        portalActive={false}
        swapActive={false}
        freezeSelectActive={false}
        isGremlin={true}
        isThinking={false}
        soundEnabled={true}
        onToggleSound={() => {}}
      />,
    );
    const icon = container.querySelector('.turn-icon');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe(PLAYERS[3].icon);
  });

  it('switches to 🤔 when isThinking=true', () => {
    const player = { ...PLAYERS[3], name: PLAYERS[3].name };
    const { container } = render(
      <TurnIndicator
        player={player}
        taunt="thinking"
        timeLeft={9}
        totalTime={10}
        portalActive={false}
        swapActive={false}
        freezeSelectActive={false}
        isGremlin={true}
        isThinking={true}
        soundEnabled={true}
        onToggleSound={() => {}}
      />,
    );
    const icon = container.querySelector('.turn-icon');
    expect(icon).not.toBeNull();
    expect(icon.textContent).toBe('🤔');
  });
});
