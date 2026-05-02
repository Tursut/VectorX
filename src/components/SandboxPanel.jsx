import { useState } from 'react';
import { ITEM_TYPES } from '../game/constants';
import SoundToggle from './SoundToggle';
import * as sounds from '../game/sounds';

const SANDBOX_SOUNDS_OPEN_KEY = 'sandboxSoundsOpen';

function readSandboxSoundsOpen() {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SANDBOX_SOUNDS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

const SOUND_BUTTONS = [
  { label: '▶ Move',        fn: () => sounds.playMove(false) },
  { label: '▶ Claim',       fn: () => sounds.playClaim() },
  { label: '▶ Your turn',   fn: () => sounds.playYourTurn() },
  { label: '▶ Tick',        fn: () => sounds.playTick(0.5) },
  { label: '▶ Bomb',        fn: () => sounds.playBomb() },
  { label: '▶ Portal',      fn: () => sounds.playPortal() },
  { label: '▶ Jump',        fn: () => sounds.playPortalJump() },
  { label: '▶ Freeze',      fn: () => sounds.playFreeze() },
  { label: '▶ Swap',        fn: () => sounds.playSwap() },
  { label: '▶ Eliminate',   fn: () => sounds.playElimination() },
  { label: '▶ Win',         fn: () => sounds.playWin() },
  { label: '▶ Draw',        fn: () => sounds.playDraw() },
  { label: '▶ Beat',        fn: () => sounds.playCountdownBeat() },
  { label: '▶ Go!',         fn: () => sounds.playCountdownGo() },
];

export default function SandboxPanel({
  currentPlayer, isThinking, portalActive, swapActive,
  onPlaceItem, onReset, onExit, soundEnabled, onToggleSound,
  audioDebugEnabled = false, onSetAudioDebugEnabled,
}) {
  let statusText = `${currentPlayer.name}'s turn`;
  if (isThinking)   statusText = 'Bot is thinking…';
  if (portalActive) statusText = '🌀 Portal active — pick any empty cell';
  if (swapActive)   statusText = '🎭 Swap active — click a player to swap with';

  const buttonsEnabled = !isThinking && !portalActive && !swapActive;
  const audioDebugLabel = audioDebugEnabled ? 'AUDIO DEBUG: ON' : 'AUDIO DEBUG: OFF';
  const [soundsOpen, setSoundsOpen] = useState(readSandboxSoundsOpen);

  function handleToggleSoundsOpen() {
    setSoundsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SANDBOX_SOUNDS_OPEN_KEY, next ? '1' : '0');
      } catch {
        // Ignore persistence failures.
      }
      return next;
    });
  }

  function handleToggleAudioDebug() {
    const next = !audioDebugEnabled;
    if (next) {
      sounds.logAudioDebugEvent('gesture-sandbox-enable-audio-debug');
      sounds.resumeAudio();
    }
    onSetAudioDebugEnabled?.(next);
  }

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
        <button
          className={`sandbox-ctrl-btn sandbox-debug-btn${audioDebugEnabled ? ' is-active' : ''}`}
          onClick={handleToggleAudioDebug}
          title="Toggle audio debug overlay"
        >
          {audioDebugLabel}
        </button>
        <button className="sandbox-ctrl-btn sandbox-exit-btn" onClick={onExit} title="Back to menu">
          ✕ Exit
        </button>
      </div>

      <div className={`sandbox-sound-section${soundsOpen ? ' is-open' : ''}`}>
        <button
          type="button"
          className="sandbox-sound-toggle"
          onClick={handleToggleSoundsOpen}
          aria-expanded={soundsOpen}
          aria-controls="sandbox-sound-grid"
        >
          <span className="sandbox-sound-chevron" aria-hidden="true">
            {soundsOpen ? '▲' : '▼'}
          </span>
          <span>SOUNDS ({SOUND_BUTTONS.length})</span>
        </button>
        <div id="sandbox-sound-grid" className="sandbox-sound-grid">
          {SOUND_BUTTONS.map(({ label, fn }) => (
            <button key={label} className="sandbox-sound-btn" onClick={fn}>
              {label}
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}
