import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ENABLE_ONLINE, SERVER_URL } from './config';
import * as sounds from './game/sounds';
import LocalGameController from './LocalGameController';
import MenuAvatarStage from './components/MenuAvatarStage';
import WaitingFlourish from './components/WaitingFlourish';
import './App.css';

// Online subtree is lazy-loaded so its zod + hook + component deps only ship
// when ENABLE_ONLINE is true at build time. With the flag off, Rollup drops
// the dynamic import entirely.
const OnlineGameController = ENABLE_ONLINE
  ? lazy(() => import('./OnlineGameController'))
  : null;

// Parse a share-link cold-open from the URL hash (`#/r/ABCDE`). Returns the
// room code or null. Accepts both upper and lower case; the code alphabet
// is all uppercase so we normalise.
function parseHashCode() {
  if (typeof window === 'undefined') return null;
  const m = window.location.hash.match(/#\/r\/([23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjklmnpqrstuvwxyz]{5})/);
  return m ? m[1].toUpperCase() : null;
}

// Clear a `#/r/…` hash from the URL without reloading. Called when the user
// leaves an online session so a refresh doesn't re-trigger the cold-open
// flow into a now-stale room.
function clearRoomHash() {
  if (typeof window === 'undefined') return;
  if (!window.location.hash.startsWith('#/r/')) return;
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  );
}

// Server-side ERROR codes that should bounce the user back to the join form
// with their inputs preserved (instead of showing a full-screen error panel
// with just a "Back" button). These are all "you can't join with these
// inputs as they stand — fix them" situations.
const ROUTABLE_JOIN_ERRORS = {
  DUPLICATE_NAME:   'That name is already taken in this room. Try another.',
  ROOM_FULL:        'This room is full.',
  ALREADY_STARTED:  'This game has already started.',
};

// Minimum time the WaitingFlourish stays on screen during room
// creation. The overlay is rendered at the App level (not inside
// StartScreen) so it can outlive the StartScreen → OnlineGameController
// transition and stay up until the WS+HELLO+LOBBY_STATE round-trip
// reports back via onReady — see issue #74.
const MIN_CREATING_DURATION_MS = 2100;
const AUDIO_DEBUG_FLAG_KEY = 'audioDebugEnabled';

function readAudioDebugEnabled() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('audiodebug');
  if (fromQuery === '1' || fromQuery === 'true') return true;
  if (fromQuery === '0' || fromQuery === 'false') return false;
  try {
    return localStorage.getItem(AUDIO_DEBUG_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

export default function App() {
  // { code, displayName, magicItems } when we're in an active online session,
  // null otherwise. Setting this transitions the whole app to OnlineGameController.
  const [online, setOnline] = useState(null);
  // Transient error shown on StartScreen — e.g. POST /rooms failed, or the
  // server rejected a HELLO with DUPLICATE_NAME / ROOM_FULL / ALREADY_STARTED.
  const [onlineError, setOnlineError] = useState(null);
  // Diagnostic context attached to the routable-error bounce. Set when the
  // server's ERROR.message carries useful state (handleHello attaches the
  // current lobby roster on ALREADY_STARTED). Rendered as a small monospace
  // block under the inline error on StartScreen so a real user can screenshot
  // and report. Cleared whenever the inline error clears.
  const [onlineErrorDebug, setOnlineErrorDebug] = useState(null);
  // Hash-prefilled code. Null after any transition so refreshes don't loop.
  const [coldOpenCode, setColdOpenCode] = useState(
    ENABLE_ONLINE ? parseHashCode() : null,
  );
  // Inputs from a join attempt the server rejected (issue #14). When set, the
  // start screen renders in JOIN mode with these pre-filled so the user can
  // tweak the name and retry without losing context.
  const [pendingDisplayName, setPendingDisplayName] = useState('');
  const [pendingCode, setPendingCode] = useState('');
  // True while the POST /rooms is in flight + the WS handshake +
  // the minimum-display window. Drives the App-level WaitingFlourish
  // overlay. Cleared by handleOnlineReady once the controller reports
  // its lobby is live (issue #74).
  const [creatingRoom, setCreatingRoom] = useState(false);
  // Wall-clock at which the current creating-room overlay started, so
  // handleOnlineReady can enforce MIN_CREATING_DURATION_MS regardless
  // of how fast POST + WS resolved.
  const creatingStartedAtRef = useRef(0);
  // Guard against a re-fire of handleOnlineReady (a reconnect mid-game
  // would re-deliver a LOBBY_STATE; we only want the first one to
  // dismiss the overlay).
  const onlineReadyHandledRef = useRef(false);
  // Pending dismiss timer so we can cancel it if the user exits during
  // the min-duration tail.
  const dismissTimerRef = useRef(null);
  const [audioDebugEnabled, setAudioDebugEnabled] = useState(readAudioDebugEnabled);
  // One-shot: next StartScreen mount opens the friends drawer (create/join) after
  // leaving a lobby / post-game room list — browser back parity (issue #90).
  const [resumeFriendsDrawer, setResumeFriendsDrawer] = useState(false);

  function handleSetAudioDebugEnabled(next) {
    setAudioDebugEnabled(next);
    try {
      localStorage.setItem(AUDIO_DEBUG_FLAG_KEY, next ? '1' : '0');
    } catch {
      // Ignore persistence failures.
    }
  }

  function clearDismissTimer() {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }

  async function handleCreateOnline({ displayName, magicItems }) {
    // Synchronous call inside the click handler chain so iOS Safari counts
    // this as a user gesture and lets us create/resume the AudioContext.
    // Without it the joiner (and sometimes the host) gets no bg music until
    // their next tap (issue #6). For the host, the lobby's "Start game"
    // button also calls resumeAudio — this is a second belt-and-braces.
    sounds.logAudioDebugEvent('gesture-create-online');
    sounds.resumeAudio();
    setOnlineError(null);
    setOnlineErrorDebug(null);
    setPendingDisplayName('');
    setPendingCode('');
    clearDismissTimer();
    onlineReadyHandledRef.current = false;
    creatingStartedAtRef.current = Date.now();
    setCreatingRoom(true);
    try {
      const res = await fetch(`${SERVER_URL}/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body = await res.json();
      // Mount OnlineGameController immediately so the WS handshake
      // runs in parallel with the overlay's minimum-display window.
      // The overlay stays up (creatingRoom === true) until either the
      // controller's lobby is live or a fatal error is surfaced —
      // handleOnlineReady drives the dismiss (issue #74).
    setColdOpenCode(null);
    setResumeFriendsDrawer(false);
    setOnline({ code: body.code, displayName, magicItems });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setOnlineError(`Couldn't reach the server: ${reason}`);
      setCreatingRoom(false);
      onlineReadyHandledRef.current = false;
    }
  }

  // Called by OnlineGameController exactly once when its lobby first
  // becomes available (or a fatal error appears, so the overlay
  // doesn't trap the user behind a flourish on top of an error
  // status). Holds the overlay for the remainder of
  // MIN_CREATING_DURATION_MS so the parade always gets its full beat.
  const handleOnlineReady = useCallback(() => {
    if (onlineReadyHandledRef.current) return;
    onlineReadyHandledRef.current = true;
    if (!creatingStartedAtRef.current) {
      setCreatingRoom(false);
      return;
    }
    const elapsed = Date.now() - creatingStartedAtRef.current;
    const remaining = MIN_CREATING_DURATION_MS - elapsed;
    if (remaining <= 0) {
      setCreatingRoom(false);
      return;
    }
    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      setCreatingRoom(false);
    }, remaining);
  }, []);

  function handleJoinOnline({ displayName, code }) {
    setOnlineErrorDebug(null);
    // Same iOS-gesture rationale as handleCreateOnline. Critical for the
    // joiner — JOIN ROOM is their last user gesture before the host starts
    // the game; without resumeAudio here their AudioContext never exists
    // and bg music silently fails to start (issue #6).
    sounds.logAudioDebugEvent('gesture-join-online');
    sounds.resumeAudio();
    setOnlineError(null);
    setColdOpenCode(null);
    setPendingDisplayName('');
    setPendingCode('');
    // Joiner's initial magic-items choice is irrelevant — host decides.
    // Default false just so the lobby has a concrete value.
    setResumeFriendsDrawer(false);
    setOnline({ code, displayName, magicItems: false });
  }

  // OnlineGameController calls this when the WS handshake fails with one of
  // the routable codes. We tear down the online session and re-render the
  // start screen in JOIN mode with the rejected inputs preserved + an
  // inline error explaining what to fix.
  function handleJoinFailed({ code, message }) {
    const debug = online
      ? {
          code,
          message: message ?? null,
          room: online.code,
          displayName: online.displayName,
          at: new Date().toISOString().slice(11, 23),
        }
      : { code, message: message ?? null };
    if (online) {
      setPendingDisplayName(online.displayName);
      setPendingCode(online.code);
    }
    setOnline(null);
    setOnlineError(ROUTABLE_JOIN_ERRORS[code] ?? `Error: ${code}`);
    setOnlineErrorDebug(debug);
    clearDismissTimer();
    setCreatingRoom(false);
    onlineReadyHandledRef.current = false;
    clearRoomHash();
    setResumeFriendsDrawer(false);
  }

  /** @param {{ target?: 'menu' | 'friends' }} [options] */
  function handleOnlineExit(options = {}) {
    const target = options.target ?? 'menu';
    setOnline(null);
    setOnlineError(null);
    setOnlineErrorDebug(null);
    setPendingDisplayName('');
    setPendingCode('');
    clearDismissTimer();
    setCreatingRoom(false);
    onlineReadyHandledRef.current = false;
    clearRoomHash();
    setResumeFriendsDrawer(target === 'friends');
  }

  useEffect(() => {
    if (online || !resumeFriendsDrawer) return;
    setResumeFriendsDrawer(false);
  }, [online, resumeFriendsDrawer]);

  // Effective default-mode + defaults. A pending failed-join takes priority
  // over a cold-open hash code; both fall back to the hotseat default.
  const effectiveDefaultCode = pendingCode || coldOpenCode || '';
  const effectiveDefaultMode =
    pendingCode || (ENABLE_ONLINE && coldOpenCode)
      ? 'join'
      : resumeFriendsDrawer
        ? 'create'
        : 'this-device';

  // MenuAvatarStage lives here (above the controller swap) so the bubble
  // drift is one continuous animation across start/lobby/gameover instead of
  // remounting whenever the active controller changes. Visibility is driven
  // by body[data-bg-hidden] which the controllers toggle via useBgHidden.
  return (
    <>
      <MenuAvatarStage />
      {ENABLE_ONLINE && online && OnlineGameController ? (
        <Suspense fallback={null}>
          <OnlineGameController
            code={online.code}
            displayName={online.displayName}
            initialMagicItems={online.magicItems}
            onExit={handleOnlineExit}
            onJoinFailed={handleJoinFailed}
            onReady={handleOnlineReady}
            suppressStatusScreens={creatingRoom}
            audioDebugEnabled={audioDebugEnabled}
          />
        </Suspense>
      ) : (
        <LocalGameController
          onCreateOnline={ENABLE_ONLINE ? handleCreateOnline : null}
          onJoinOnline={ENABLE_ONLINE ? handleJoinOnline : null}
          defaultMode={effectiveDefaultMode}
          defaultCode={effectiveDefaultCode}
          defaultDisplayName={pendingDisplayName}
          onlineError={onlineError}
          onlineErrorDebug={onlineErrorDebug}
          audioDebugEnabled={audioDebugEnabled}
          onSetAudioDebugEnabled={handleSetAudioDebugEnabled}
        />
      )}
      <AnimatePresence>
        {creatingRoom && (
          <motion.div
            key="creating-room-overlay"
            className="waiting-flourish-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.3, delay: 0.5 } }}
            transition={{ duration: 0.3 }}
          >
            <motion.div
              key="flourish"
              className="waiting-flourish-card-wrap"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, transition: { duration: 0.3, delay: 0.5 } }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            >
              <WaitingFlourish />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
