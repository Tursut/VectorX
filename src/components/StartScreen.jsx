import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PLAYERS, ITEM_TYPES } from '../game/constants';
import { generateDisplayName } from '../game/nameGenerator';
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

// Replace each letter with a random letter of the same case; spaces stay
// spaces. Used by the dice-button scramble animation.
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
  // App.jsx prefills this when re-rendering after a server-side join rejection
  // (e.g. DUPLICATE_NAME) so the user lands on the join form with the rejected
  // name still in the field — they just edit and retry. Otherwise we seed a
  // quirky "Otis the Sly"-style suggestion via the name generator so the user
  // has a delightful one-tap default; the reroll button below shuffles it.
  const [displayName, setDisplayName] = useState(
    () => defaultDisplayName || generateDisplayName(),
  );
  // 'name' | 'code' | null. Set when the user submits with that field still
  // invalid; rendered as an inline message + a brief shake on the input.
  // Clears as soon as the offending field becomes valid (via useEffect below).
  const [submitError, setSubmitError] = useState(null);
  const nameInputRef = useRef(null);
  const codeInputRef = useRef(null);
  // Tracks the in-flight reroll scramble: { id, target } where id is the
  // setInterval handle and target is the final name to settle on. Lets us
  // cancel cleanly on unmount or user typing, and snap to the real name if
  // the user submits mid-animation.
  const rerollAnimRef = useRef({ id: null, target: null });

  // Cancel a pending scramble animation. Idempotent.
  function cancelRerollAnim() {
    if (rerollAnimRef.current.id !== null) {
      clearInterval(rerollAnimRef.current.id);
      rerollAnimRef.current.id = null;
    }
  }

  // Cleanup on unmount so stray intervals don't update unmounted state.
  useEffect(() => () => cancelRerollAnim(), []);

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

  function rerollDisplayName() {
    cancelRerollAnim();
    const target = generateDisplayName();
    setSubmitError(null);
    rerollAnimRef.current.target = target;    // ~200 ms slot-machine scramble: 7 frames of random letters at 28 ms each,
    // then snap to the target. Same-case letters keep the silhouette stable
    // so the eye stays on the new name as it settles.
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

  // Back-out from a cold-open join. Drops the joiner-stripped view by
  // switching to the default hotseat mode + clearing the pre-filled code,
  // and strips the share-link hash so a refresh doesn't re-trigger join
  // mode. This is the only way out for someone who tapped a share link
  // and changed their mind — the mode-switcher tabs are hidden in the
  // joiner view, so without this they'd be stuck with JOIN ROOM as the
  // only action.
  function backToMenuFromJoiner() {
    setMode('this-device');
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

  // When the offending field becomes valid (user starts typing), drop the error
  // so the inline message + shake disappear without waiting for another submit.
  useEffect(() => {
    if (submitError === 'name' && isDisplayNameValid(displayName)) {
      setSubmitError(null);
    } else if (submitError === 'code' && hasCode) {
      setSubmitError(null);
    }
  }, [submitError, displayName, hasCode]);

  function handlePrimaryClick() {
    // If a scramble is mid-flight, snap to its real target before validating
    // — otherwise we'd send a randomised string. The animation is ~200 ms,
    // so this is an edge case but worth handling.
    let effectiveName = displayName;
    if (rerollAnimRef.current.id !== null) {
      cancelRerollAnim();
      effectiveName = rerollAnimRef.current.target;
      setDisplayName(effectiveName);
    }
    if (isCreate) {
      if (!isDisplayNameValid(effectiveName)) {
        setSubmitError('name');
        nameInputRef.current?.focus();
        return;
      }
      setSubmitError(null);
      onCreateOnline({ displayName: effectiveName.trim(), magicItems });
      return;
    }
    if (isJoin) {
      // Validate name first, then code — focus the first invalid field so the
      // user only has to fix one thing at a time.
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

  const primaryLabel = isCreate
    ? 'CREATE ROOM →'
    : isJoin
      ? 'JOIN ROOM →'
      : 'START THE GAME →';

  // Joiners don't pick magic items — the host does. Hide Magic/Classic
  // toggle in that case; everyone else sees it.
  const showMagicToggle = !isJoiner;

  // Name input shared by both online drawers (create + join). Inline so the
  // surrounding drawers keep their existing crossfade/JSX shapes.
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

  return (
    <div className="start-screen">
      <div className="start-content">
        <div className="start-sound-corner">
          <SoundToggle enabled={soundEnabled} onToggle={onToggleSound} />
        </div>
        <h1 className="start-title">MIND THE GRID</h1>
        <p className="start-subtitle">
          Four players. One grid. Only one walks away smiling.
        </p>

        {/* Tile row + drawer wrapped in one container so the parent's
            `gap: 20px` doesn't pry them apart — inside here they can touch,
            letting the active tile merge into the drawer visually. */}
        <div className="mode-block">
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
              <span className="mode-switcher-label">SAME SCREEN</span>
              <span className="mode-switcher-sub">Pass-and-play. Bots fill open seats.</span>
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

        {/* Mode-specific drawer — crossfades in place at a fixed height so
            switching tiles doesn't shift the layout below. The outer
            .mode-drawer owns the border/bg and visually merges with the
            active tile above (see App.css). */}
        <div className="mode-drawer">
          <AnimatePresence mode="wait" initial={false}>
            {mode === 'this-device' && (
              <motion.div
                key="this-device-drawer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
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
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <div className="online-section">
                  {nameInput}
                  {onlineError && (
                    <p className="online-error" role="alert">
                      {onlineError}
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {mode === 'join' && (
              <motion.div
                key="join-drawer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              >
                <div className="online-section">
                  {nameInput}
                  <label className="join-field">
                    <span>Room code</span>
                    <input
                      ref={codeInputRef}
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
                      className={submitError === 'code' ? 'input-shake input-error' : ''}
                      aria-invalid={submitError === 'code'}
                    />
                  </label>
                  {submitError === 'code' && (
                    <p className="field-error" role="alert">Enter a 5-character room code.</p>
                  )}
                  {onlineError && (
                    <p className="online-error" role="alert">
                      {onlineError}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        </div>

        {/* "← Back to menu" sits below the form card, aligned to its left
            edge — same vocabulary as the Lobby and GameScreen exit links.
            Only rendered in the joiner-stripped view (mode-switcher hidden),
            since otherwise the user can just tap a different mode tile. */}
        {isJoiner && (
          <button
            type="button"
            className="exit-game-btn"
            onClick={backToMenuFromJoiner}
          >
            ← Back to menu
          </button>
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

        {!isOnline && (
          <button className="sandbox-entry-btn" onClick={onSandbox}>🧪 testing ground</button>
        )}
      </div>

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

      <p className="start-build-stamp">built {BUILD_TIME}</p>
    </div>
  );
}
