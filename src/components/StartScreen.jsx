import { useEffect, useRef, useState } from 'react';
import { PLAYERS, ITEM_TYPES } from '../game/constants';
import { BUILD_TIME } from '../config';
import SoundToggle from './SoundToggle';

// Room-code alphabet mirrors server/protocol.ts. Filter as the user types;
// paste extracts the code from a share link (/r/ABCDE) before falling back
// to the first 5-char alphabet token.
const CODE_ALPHABET_RE = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g;
const CODE_TOKEN_RE = /[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}/;

function filterCode(raw) {
  return (raw.toUpperCase().match(CODE_ALPHABET_RE) ?? []).join('').slice(0, 5);
}

function extractCodeFromPaste(text) {
  const upper = text.toUpperCase();
  const linkHit = upper.match(/\/R\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5})/);
  if (linkHit) return linkHit[1];
  const tokenHit = upper.match(CODE_TOKEN_RE);
  return tokenHit ? tokenHit[0] : null;
}

function isDisplayNameValid(raw) {
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 20;
}

function isCodeValid(code) {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(code);
}

export default function StartScreen({
  onStart,
  onSandbox,
  magicItems,
  onToggleMagicItems,
  gremlinCount,
  onChangeGremlinCount,
  soundEnabled,
  onToggleSound,
  onCreateOnline,
  onJoinOnline,
  defaultMode = 'same-device',
  defaultCode = '',
  onlineError = null,
}) {
  // Online handlers are required for the switcher to show. When ENABLE_ONLINE
  // is false, App.jsx passes null for both and the screen behaves exactly
  // like the hotseat-only design.
  const onlineAvailable =
    typeof onCreateOnline === 'function' &&
    typeof onJoinOnline === 'function';

  const [mode, setMode] = useState(onlineAvailable ? defaultMode : 'same-device');
  const [code, setCode] = useState(filterCode(defaultCode));
  const [displayName, setDisplayName] = useState('');
  const nameInputRef = useRef(null);

  // When the user (or a cold-open) lands on online mode, focus the name
  // field. Users arriving via a share link usually have the code pre-filled
  // and just need to type their name.
  useEffect(() => {
    if (mode === 'online') {
      nameInputRef.current?.focus();
    }
  }, [mode]);

  const humanCount = PLAYERS.length - gremlinCount;
  const gremlinLabel =
    gremlinCount === 0 ? 'All human. May the best player win.' :
    gremlinCount === 4 ? 'All gremlins — sit back and enjoy the show.' :
    humanCount === 1 ? 'Just you vs the gremlins. Good luck.' :
    `${humanCount} humans, ${gremlinCount} gremlins.`;

  const isOnline = mode === 'online';
  const hasCode = isCodeValid(code);
  // A "joiner" landed on a share link: online + valid code pre-filled.
  // We strip the screen down to just name + code + JOIN for them.
  const isJoiner = isOnline && hasCode;
  // In online mode, submit needs a valid name + (empty code OR a valid code).
  const canSubmitOnline =
    isDisplayNameValid(displayName) && (code === '' || hasCode);

  function handleCodeChange(e) {
    setCode(filterCode(e.target.value));
  }

  function handleCodePaste(e) {
    const pasted = e.clipboardData?.getData('text');
    if (!pasted) return;
    const token = extractCodeFromPaste(pasted);
    if (token) {
      e.preventDefault();
      setCode(token);
    }
  }

  function handlePrimaryClick() {
    if (isOnline) {
      if (!canSubmitOnline) return;
      if (hasCode) {
        onJoinOnline({ displayName: displayName.trim(), code });
      } else {
        onCreateOnline({ displayName: displayName.trim(), magicItems });
      }
      return;
    }
    onStart?.();
  }

  const primaryLabel = !isOnline
    ? 'START THE GAME →'
    : hasCode
      ? 'JOIN ROOM →'
      : 'CREATE ROOM →';

  // In online mode with a code present, the joiner doesn't pick magic items
  // — the host does. Hide the Magic/Classic toggle + items list then.
  const showMagicToggle = !isOnline || !hasCode;

  return (
    <div className="start-screen">
      <div className="start-content">
        <div className="start-sound-corner">
          <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        </div>
        <h1 className="start-title">GRIDMIND</h1>
        <p className="start-subtitle">
          Four players. One grid. Only one walks away smiling.
        </p>

        {/* Mode switcher — only when online is available, and hidden for joiners */}
        {onlineAvailable && !isJoiner && (
          <div className="mode-switcher" role="tablist" aria-label="Game mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isOnline}
              className={`mode-switcher-tile ${!isOnline ? 'mode-switcher-tile-active' : ''}`}
              onClick={() => setMode('same-device')}
            >
              <span className="mode-switcher-icon">🎮</span>
              <span className="mode-switcher-label">SAME DEVICE</span>
              <span className="mode-switcher-sub">On this device, bots fill the rest</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isOnline}
              className={`mode-switcher-tile ${isOnline ? 'mode-switcher-tile-active' : ''}`}
              onClick={() => setMode('online')}
            >
              <span className="mode-switcher-icon">🌐</span>
              <span className="mode-switcher-label">ONLINE</span>
              <span className="mode-switcher-sub">Friends over the internet</span>
            </button>
          </div>
        )}

        {/* Mode-specific top block */}
        {!isOnline ? (
          <div className="gremlin-section">
            <p className="gremlin-question">Who's playing?</p>
            <div className="gremlin-slots">
              {PLAYERS.map((p) => {
                const isGremlin = p.id >= PLAYERS.length - gremlinCount;
                return (
                  <div key={p.id} className={`gremlin-slot ${isGremlin ? 'gremlin-slot-bot' : 'gremlin-slot-human'}`}>
                    <div
                      className="gremlin-slot-avatar"
                      style={isGremlin ? {} : { backgroundColor: p.color }}
                    >
                      {isGremlin ? '👾' : p.icon}
                    </div>
                    <span className="gremlin-slot-name" style={isGremlin ? {} : { color: p.color }}>
                      {p.shortName}
                    </span>
                    <span className="gremlin-slot-type">
                      {isGremlin ? 'gremlin' : 'human'}
                    </span>
                  </div>
                );
              })}
            </div>
            <input
              type="range"
              min="0"
              max="4"
              value={4 - gremlinCount}
              onChange={(e) => onChangeGremlinCount(4 - Number(e.target.value))}
              className="gremlin-slider"
            />
            <p className="gremlin-sub">{gremlinLabel}</p>
          </div>
        ) : (
          <div className="online-section">
            <label className="join-field">
              <span>Your name</span>
              <input
                ref={nameInputRef}
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Alice"
                maxLength={20}
                autoComplete="off"
              />
            </label>
            <label className="join-field">
              <span>
                Room code{' '}
                <span className="join-subhint">(leave blank to create a new room)</span>
              </span>
              <input
                type="text"
                value={code}
                onChange={handleCodeChange}
                onPaste={handleCodePaste}
                placeholder="ABCDE"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                maxLength={5}
                aria-label="Room code"
              />
            </label>
            {onlineError && (
              <p className="online-error" role="alert">
                Couldn't reach the server: {onlineError}
              </p>
            )}
          </div>
        )}

        {/* Magic / Classic toggle — hidden entirely for share-link joiners */}
        {!isJoiner && (
        <div className="mode-section">
          {showMagicToggle ? (
            <div className="mode-selector">
              <button
                type="button"
                className={`mode-btn ${magicItems ? 'mode-btn-active mode-btn-magic' : ''}`}
                onClick={() => !magicItems && onToggleMagicItems()}
              >
                <span className="mode-btn-icon">✨</span>
                <span className="mode-btn-label">MAGIC</span>
                <span className="mode-btn-sub">Items appear. Things get interesting.</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${!magicItems ? 'mode-btn-active mode-btn-classic' : ''}`}
                onClick={() => magicItems && onToggleMagicItems()}
              >
                <span className="mode-btn-icon">⚔️</span>
                <span className="mode-btn-label">CLASSIC</span>
                <span className="mode-btn-sub">Pure territory, no surprises.</span>
              </button>
            </div>
          ) : (
            <div className="mode-hostnote">
              <span className="mode-btn-icon">✨</span>
              The host picks magic items for this room.
            </div>
          )}

          {magicItems && showMagicToggle && (
            <div className="magic-items-list">
              {Object.values(ITEM_TYPES).map((item) => (
                <div key={item.type} className="magic-item-entry">
                  <span className="magic-item-icon">{item.icon}</span>
                  <div>
                    <span className="magic-item-name" style={{ color: item.color }}>{item.name}</span>
                    <span className="magic-item-desc"> — {item.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {!isJoiner && (
          <div className="start-rules">
            <p>🗺️ Move onto any adjacent square — including diagonally.</p>
            <p>🔒 Claimed squares are locked forever. No take-backs.</p>
            <p>💀 No moves left? You're out. Try not to corner yourself.</p>
            <p>🏆 Last one moving wins. Simple. Clever. Perfect.</p>
          </div>
        )}

        {!isJoiner && (
          <p className="start-footnote">Starting player chosen by fate (it's random).</p>
        )}
        {!isOnline && (
          <button className="sandbox-entry-btn" onClick={onSandbox}>🧪 testing ground</button>
        )}
      </div>

      <div className="start-button-bar">
        <button
          className="start-button"
          onClick={handlePrimaryClick}
          disabled={isOnline && !canSubmitOnline}
        >
          {primaryLabel}
        </button>
      </div>

      <p className="start-build-stamp">built {BUILD_TIME}</p>
    </div>
  );
}
