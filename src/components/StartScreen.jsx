import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  defaultMode = 'this-device',
  defaultCode = '',
  onlineError = null,
}) {
  // Online handlers are required for the create/join tiles to show. When
  // ENABLE_ONLINE is false, App.jsx passes null for both and the screen
  // behaves exactly like the hotseat-only design.
  const onlineAvailable =
    typeof onCreateOnline === 'function' &&
    typeof onJoinOnline === 'function';

  // Three-mode state: 'this-device' (hotseat + bots), 'create' (host a new
  // online room), 'join' (enter someone else's room).
  const [mode, setMode] = useState(onlineAvailable ? defaultMode : 'this-device');
  const [code, setCode] = useState(filterCode(defaultCode));
  const [displayName, setDisplayName] = useState('');

  const humanCount = PLAYERS.length - gremlinCount;
  const gremlinLabel =
    gremlinCount === 0 ? 'All human. May the best player win.' :
    gremlinCount === 4 ? 'All gremlins — sit back and enjoy the show.' :
    humanCount === 1 ? 'Just you vs the gremlins. Good luck.' :
    `${humanCount} humans, ${gremlinCount} gremlins.`;

  const isCreate = mode === 'create';
  const isJoin = mode === 'join';
  const isOnline = isCreate || isJoin;
  const hasCode = isCodeValid(code);
  // A "joiner" landed on a share link: join tile + valid code pre-filled.
  // Strip the screen down to just name + code + JOIN for them.
  const isJoiner = isJoin && hasCode;
  const canSubmitCreate = isDisplayNameValid(displayName);
  const canSubmitJoin = isDisplayNameValid(displayName) && hasCode;
  const canSubmit = isCreate ? canSubmitCreate : isJoin ? canSubmitJoin : true;

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
    if (isCreate) {
      if (!canSubmitCreate) return;
      onCreateOnline({ displayName: displayName.trim(), magicItems });
      return;
    }
    if (isJoin) {
      if (!canSubmitJoin) return;
      onJoinOnline({ displayName: displayName.trim(), code });
      return;
    }
    onStart?.();
  }

  const primaryLabel = isCreate
    ? 'CREATE ROOM →'
    : isJoin
      ? 'JOIN ROOM →'
      : 'START THE GAME →';

  // Joiners don't pick magic items — the host does. Hide Magic/Classic
  // toggle in that case; everyone else sees it.
  const showMagicToggle = !isJoiner;

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

        {/* Mode switcher — hidden for joiners (share-link minimal view) */}
        {onlineAvailable && !isJoiner && (
          <div className="mode-switcher" role="tablist" aria-label="Game mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'this-device'}
              className={`mode-switcher-tile ${mode === 'this-device' ? 'mode-switcher-tile-active' : ''}`}
              onClick={() => setMode('this-device')}
            >
              <span className="mode-switcher-icon">🎮</span>
              <span className="mode-switcher-label">THIS DEVICE</span>
              <span className="mode-switcher-sub">On this device, bots fill the rest</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'create'}
              className={`mode-switcher-tile ${mode === 'create' ? 'mode-switcher-tile-active' : ''}`}
              onClick={() => setMode('create')}
            >
              <span className="mode-switcher-icon">➕</span>
              <span className="mode-switcher-label">CREATE ROOM</span>
              <span className="mode-switcher-sub">Start a new room for friends</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'join'}
              className={`mode-switcher-tile ${mode === 'join' ? 'mode-switcher-tile-active' : ''}`}
              onClick={() => setMode('join')}
            >
              <span className="mode-switcher-icon">🔗</span>
              <span className="mode-switcher-label">JOIN ROOM</span>
              <span className="mode-switcher-sub">Enter a code to join a room</span>
            </button>
          </div>
        )}

        {/* Mode-specific drawer — animates height+opacity below the tile row */}
        <AnimatePresence mode="wait" initial={false}>
          {mode === 'this-device' && (
            <motion.div
              key="this-device-drawer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden', width: '100%' }}
            >
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
            </motion.div>
          )}

          {mode === 'create' && (
            <motion.div
              key="create-drawer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden', width: '100%' }}
            >
              <div className="online-section">
                <label className="join-field">
                  <span>Your name</span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alice"
                    maxLength={20}
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                {onlineError && (
                  <p className="online-error" role="alert">
                    Couldn't reach the server: {onlineError}
                  </p>
                )}
              </div>
            </motion.div>
          )}

          {mode === 'join' && (
            <motion.div
              key="join-drawer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22 }}
              style={{ overflow: 'hidden', width: '100%' }}
            >
              <div className="online-section">
                <label className="join-field">
                  <span>Your name</span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alice"
                    maxLength={20}
                    autoComplete="off"
                    autoFocus
                  />
                </label>
                <label className="join-field">
                  <span>Room code</span>
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
            </motion.div>
          )}
        </AnimatePresence>

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
          disabled={!canSubmit}
        >
          {primaryLabel}
        </button>
      </div>

      <p className="start-build-stamp">built {BUILD_TIME}</p>
    </div>
  );
}
