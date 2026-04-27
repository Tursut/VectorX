import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS, ITEM_TYPES } from '../game/constants';
import { generateDisplayName } from '../game/nameGenerator';
import { playClick } from '../game/sounds';
import { BUILD_TIME } from '../config';
import SoundToggle from './SoundToggle';
import TapToBeginModal from './TapToBeginModal';

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

function scrambleString(target) {
  return target
    .split('')
    .map((c) => {
      if (c >= 'a' && c <= 'z') return String.fromCharCode(97 + Math.floor(Math.random() * 26));
      if (c >= 'A' && c <= 'Z') return String.fromCharCode(65 + Math.floor(Math.random() * 26));
      return c;
    })
    .join('');
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
  defaultDisplayName = '',
  onlineError = null,
  onlineErrorDebug = null,
}) {
  const onlineAvailable =
    typeof onCreateOnline === 'function' &&
    typeof onJoinOnline === 'function';

  // Three views drive the screen now: 'menu' (the front door — PLAY +
  // PLAY WITH FRIENDS hero buttons), 'online' (multiplayer drawer, with
  // a nested create/join sub-state), and 'local' (the hotseat slider
  // section that used to live behind the SAME SCREEN tab).
  // Cold-open share links + retry-after-rejection bypass the menu and
  // land directly in 'online' with joinMode=true; offline builds skip
  // 'menu' and go straight to 'local'.
  const initialView =
    !onlineAvailable
      ? 'local'
      : (defaultMode === 'create' || defaultMode === 'join')
        ? 'online'
        : 'menu';
  const [view, setView] = useState(initialView);
  const [joinMode, setJoinMode] = useState(defaultMode === 'join');

  const [code, setCode] = useState(filterCode(defaultCode));
  // App.jsx prefills this when re-rendering after a server-side join rejection
  // so the user lands on the join form with the rejected name still in the
  // field — they just edit and retry. Otherwise we seed a quirky
  // "Otis the Sly"-style suggestion via the name generator.
  const [displayName, setDisplayName] = useState(
    () => defaultDisplayName || generateDisplayName(),
  );
  const [submitError, setSubmitError] = useState(null);
  const nameInputRef = useRef(null);
  const codeInputRef = useRef(null);
  const rerollAnimRef = useRef({ id: null, target: null });

  function cancelRerollAnim() {
    if (rerollAnimRef.current.id !== null) {
      clearInterval(rerollAnimRef.current.id);
      rerollAnimRef.current.id = null;
    }
  }
  useEffect(() => () => cancelRerollAnim(), []);

  const humanCount = PLAYERS.length - gremlinCount;
  const gremlinLabel =
    gremlinCount === 0 ? 'All human. May the best player win.' :
    gremlinCount === 4 ? 'All gremlins — sit back and enjoy the show.' :
    humanCount === 1 ? 'Just you vs the gremlins. Good luck.' :
    `${humanCount} humans, ${gremlinCount} gremlins.`;

  const isOnline = view === 'online';
  const isLocal = view === 'local';
  const isMenu = view === 'menu';
  const hasCode = isCodeValid(code);
  // A "joiner" landed on a share link: online view in join mode with a
  // valid code already pre-filled. Strip the screen down to just name +
  // code + JOIN for them.
  const isJoiner = isOnline && joinMode && hasCode;
  const canSubmitCreate = isDisplayNameValid(displayName);
  const canSubmitJoin = isDisplayNameValid(displayName) && hasCode;
  const canSubmit =
    isOnline ? (joinMode ? canSubmitJoin : canSubmitCreate) : true;

  function rerollDisplayName() {
    playClick();
    cancelRerollAnim();
    const target = generateDisplayName();
    setSubmitError(null);
    rerollAnimRef.current.target = target;
    const FRAMES = 7;
    const FRAME_MS = 28;
    let step = 0;
    rerollAnimRef.current.id = setInterval(() => {
      step += 1;
      if (step >= FRAMES) {
        cancelRerollAnim();
        setDisplayName(target);
        return;
      }
      setDisplayName(scrambleString(target));
    }, FRAME_MS);
  }

  // Back-out from the online or local drawer to the menu. Also handles
  // the cold-open joiner case — a user who tapped a share link and then
  // changed their mind needs the share-link hash stripped so a refresh
  // doesn't loop them back into join mode.
  function backToMenu() {
    playClick();
    setView(onlineAvailable ? 'menu' : 'local');
    setJoinMode(false);
    setCode('');
    setSubmitError(null);
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#/r/')) {
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search,
      );
    }
  }

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

  useEffect(() => {
    if (submitError === 'name' && isDisplayNameValid(displayName)) {
      setSubmitError(null);
    } else if (submitError === 'code' && hasCode) {
      setSubmitError(null);
    }
  }, [submitError, displayName, hasCode]);

  function handlePrimaryClick() {
    playClick();
    let effectiveName = displayName;
    if (rerollAnimRef.current.id !== null) {
      cancelRerollAnim();
      effectiveName = rerollAnimRef.current.target;
      setDisplayName(effectiveName);
    }
    if (isOnline && !joinMode) {
      if (!isDisplayNameValid(effectiveName)) {
        setSubmitError('name');
        nameInputRef.current?.focus();
        return;
      }
      setSubmitError(null);
      onCreateOnline({ displayName: effectiveName.trim(), magicItems });
      return;
    }
    if (isOnline && joinMode) {
      if (!isDisplayNameValid(effectiveName)) {
        setSubmitError('name');
        nameInputRef.current?.focus();
        return;
      }
      if (!hasCode) {
        setSubmitError('code');
        codeInputRef.current?.focus();
        return;
      }
      setSubmitError(null);
      onJoinOnline({ displayName: effectiveName.trim(), code });
      return;
    }
    onStart?.();
  }

  // PLAY — instant solo. No name input, no toggles. Uses whatever
  // gremlinCount + magicItems are in App state (defaults to 1 human
  // + 3 bots, magic on per LocalGameController).
  function handlePlaySolo() {
    playClick();
    onStart?.();
  }

  function openOnline() {
    playClick();
    setView('online');
    setJoinMode(false);
    setSubmitError(null);
  }

  function openLocal() {
    playClick();
    setView('local');
    setSubmitError(null);
  }

  function toggleJoinMode() {
    playClick();
    setJoinMode((j) => !j);
    setSubmitError(null);
  }

  const primaryLabel =
    isOnline && joinMode ? 'JOIN ROOM →' :
    isOnline ? 'CREATE ROOM →' :
    'START THE GAME →';

  // Joiners don't pick magic items — the host does. Hide Magic/Classic
  // toggle in that case; create + local views see it.
  const showMagicToggle = !isJoiner && (isLocal || (isOnline && !joinMode));

  const nameInput = (
    <>
      <label className="join-field">
        <span>Your name</span>
        <div className="name-input-row">
          <input
            ref={nameInputRef}
            type="text"
            value={displayName}
            onChange={(e) => {
              cancelRerollAnim();
              setDisplayName(e.target.value);
            }}
            placeholder="Your name"
            maxLength={20}
            autoComplete="off"
            autoFocus
            data-testid="display-name-input"
            className={submitError === 'name' ? 'input-shake input-error' : ''}
            aria-invalid={submitError === 'name'}
          />
          <button
            type="button"
            className="name-reroll-btn"
            onClick={rerollDisplayName}
            aria-label="Suggest a different name"
            title="Suggest a different name"
          >
            🎲
          </button>
        </div>
      </label>
      {submitError === 'name' && (
        <p className="field-error" role="alert">Enter your name to continue.</p>
      )}
    </>
  );

  const errorBlock = onlineError && (
    <>
      <p className="online-error" role="alert">{onlineError}</p>
      {onlineErrorDebug && (
        <pre className="online-status-debug" aria-label="Debug context">
{`code:        ${onlineErrorDebug.code}
message:     ${onlineErrorDebug.message ?? '(none)'}
room:        ${onlineErrorDebug.room ?? '(unknown)'}
displayName: ${onlineErrorDebug.displayName ?? '(unknown)'}
at:          ${onlineErrorDebug.at ?? '(unknown)'}`}
        </pre>
      )}
    </>
  );

  return (
    <div className="start-screen">
      <TapToBeginModal />
      <div className="start-content">
        <div className="start-sound-corner">
          <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        </div>
        <h1 className="start-title">MIND THE GRID</h1>
        <p className="start-subtitle">
          Four players. One grid. Only one walks away smiling.
        </p>

        <AnimatePresence mode="wait" initial={false}>
          {isMenu && (
            <motion.div
              key="menu-view"
              className="start-view start-menu"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <button
                type="button"
                className="hero-button hero-button-primary"
                data-testid="hero-play"
                onClick={handlePlaySolo}
              >
                <span className="hero-button-label">PLAY</span>
                <span className="hero-button-sub">you vs three bots</span>
              </button>

              {onlineAvailable && (
                <button
                  type="button"
                  className="hero-button hero-button-secondary"
                  data-testid="hero-play-online"
                  onClick={openOnline}
                >
                  <span className="hero-button-label">PLAY WITH FRIENDS</span>
                  <span className="hero-button-sub">create or join a room</span>
                </button>
              )}

              <button
                type="button"
                className="hero-text-link"
                data-testid="hero-pass-and-play"
                onClick={openLocal}
              >
                pass-and-play on this device →
              </button>
            </motion.div>
          )}

          {isLocal && (
            <motion.div
              key="local-view"
              className="start-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {onlineAvailable && (
                <button
                  type="button"
                  className="exit-game-btn back-to-menu"
                  onClick={backToMenu}
                >
                  ← Back to menu
                </button>
              )}
              <div className="mode-drawer">
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
              </div>
            </motion.div>
          )}

          {isOnline && (
            <motion.div
              key="online-view"
              className="start-view"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <button
                type="button"
                className="exit-game-btn back-to-menu"
                onClick={backToMenu}
              >
                ← Back to menu
              </button>
              <div className="mode-drawer">
                <div className="online-section">
                  {nameInput}
                  {joinMode && (
                    <label className="join-field code-field">
                      <span>Room code</span>
                      <div
                        className={`code-grid${submitError === 'code' ? ' input-shake input-error' : ''}`}
                      >
                        {Array.from({ length: 5 }, (_, i) => {
                          const ch = code[i];
                          const isActive = i === code.length;
                          const isFilled = ch !== undefined;
                          return (
                            <div
                              key={i}
                              className={
                                'code-cell' +
                                (isActive ? ' code-cell-active' : '') +
                                (isFilled ? ' code-cell-filled' : '')
                              }
                              aria-hidden="true"
                            >
                              {ch ?? ''}
                            </div>
                          );
                        })}
                        <input
                          ref={codeInputRef}
                          className="code-input-overlay"
                          type="text"
                          value={code}
                          onChange={handleCodeChange}
                          onPaste={handleCodePaste}
                          inputMode="text"
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          autoComplete="off"
                          maxLength={5}
                          aria-label="Room code"
                          aria-invalid={submitError === 'code'}
                        />
                      </div>
                    </label>
                  )}
                  {submitError === 'code' && (
                    <p className="field-error" role="alert">Enter a 5-character room code.</p>
                  )}
                  {!isJoiner && (
                    <button
                      type="button"
                      className="online-mode-toggle"
                      data-testid="toggle-join-mode"
                      onClick={toggleJoinMode}
                    >
                      {joinMode ? 'host a new room instead' : 'got a code? join a room →'}
                    </button>
                  )}
                  {errorBlock}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {showMagicToggle && (
          <div className="mode-section">
            <div className="mode-selector">
              <button
                type="button"
                className={`mode-btn ${magicItems ? 'mode-btn-active mode-btn-magic' : ''}`}
                onClick={() => { playClick(); if (!magicItems) onToggleMagicItems(); }}
              >
                <span className="mode-btn-icon">✨</span>
                <span className="mode-btn-label">MAGIC</span>
                <span className="mode-btn-sub">Items appear. Things get interesting.</span>
              </button>
              <button
                type="button"
                className={`mode-btn ${!magicItems ? 'mode-btn-active mode-btn-classic' : ''}`}
                onClick={() => { playClick(); if (magicItems) onToggleMagicItems(); }}
              >
                <span className="mode-btn-icon">⚔️</span>
                <span className="mode-btn-label">CLASSIC</span>
                <span className="mode-btn-sub">Pure territory, no surprises.</span>
              </button>
            </div>

            {magicItems && (
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

        {isOnline && joinMode && !showMagicToggle && (
          <div className="mode-hostnote">
            <span className="mode-btn-icon">✨</span>
            The host picks magic items for this room.
          </div>
        )}

        {isMenu && (
          <div className="start-rules">
            <p>🗺️ Move onto any adjacent square — including diagonally.</p>
            <p>🔒 Claimed squares are locked forever. No take-backs.</p>
            <p>💀 No moves left? You're out. Try not to corner yourself.</p>
            <p>🏆 Last one moving wins. Simple. Clever. Perfect.</p>
          </div>
        )}

        {isMenu && (
          <button className="sandbox-entry-btn" onClick={() => { playClick(); onSandbox?.(); }}>🧪 testing ground</button>
        )}
      </div>

      {!isMenu && (
        <div className="start-button-bar">
          <button
            className="start-button"
            data-testid="primary-button"
            onClick={handlePrimaryClick}
            aria-disabled={!canSubmit}
          >
            {primaryLabel}
          </button>
        </div>
      )}

      <p className="start-build-stamp">built {BUILD_TIME}</p>
    </div>
  );
}
