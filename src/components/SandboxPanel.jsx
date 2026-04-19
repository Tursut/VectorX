import { ITEM_TYPES } from '../game/constants';
import SoundToggle from './SoundToggle';

export default function SandboxPanel({
  currentPlayer, isThinking, portalActive, swapActive,
  onPlaceItem, onReset, onExit, soundEnabled, onToggleSound,
}) {
  let statusText = `${currentPlayer.name}'s turn`;
  if (isThinking)   statusText = 'Bot is thinking…';
  if (portalActive) statusText = '🌀 Portal active — pick any empty cell';
  if (swapActive)   statusText = '🔀 Swap active — click a player to swap with';

  const buttonsEnabled = !isThinking && !portalActive && !swapActive;

  return (
    <div className="sandbox-panel" style={{ borderColor: currentPlayer.color }}>
      <div className="sandbox-status">
        <span className="sandbox-player-icon" style={{ backgroundColor: currentPlayer.color }}>
          {currentPlayer.icon}
        </span>
        <span className="sandbox-status-text">{statusText}</span>
        <span className="sandbox-badge">TESTING GROUND</span>
        <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
      </div>

      <div className="sandbox-actions">
        {Object.values(ITEM_TYPES).map((item) => (
          <button
            key={item.type}
            className="sandbox-item-btn"
            style={{ '--item-color': item.color }}
            onClick={() => onPlaceItem(item.type)}
            disabled={!buttonsEnabled}
            title={buttonsEnabled ? `Place ${item.name} next to you` : 'Wait for your turn'}
          >
            <span className="sandbox-item-btn-icon">{item.icon}</span>
            <span className="sandbox-item-btn-label">{item.name}</span>
          </button>
        ))}

        <div className="sandbox-divider" />

        <button className="sandbox-ctrl-btn sandbox-reset-btn" onClick={onReset} title="Reset board">
          ↺ Reset
        </button>
        <button className="sandbox-ctrl-btn sandbox-exit-btn" onClick={onExit} title="Back to menu">
          ✕ Exit
        </button>
      </div>
    </div>
  );
}
