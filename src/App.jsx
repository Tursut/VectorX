import { lazy, Suspense, useState } from 'react';
import { ENABLE_ONLINE, SERVER_URL } from './config';
import * as sounds from './game/sounds';
import LocalGameController from './LocalGameController';
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

export default function App() {
  // { code, displayName, magicItems } when we're in an active online session,
  // null otherwise. Setting this transitions the whole app to OnlineGameController.
  const [online, setOnline] = useState(null);
  // Transient error shown on StartScreen — e.g. POST /rooms failed, or the
  // server rejected a HELLO with DUPLICATE_NAME / ROOM_FULL / ALREADY_STARTED.
  const [onlineError, setOnlineError] = useState(null);
  // Hash-prefilled code. Null after any transition so refreshes don't loop.
  const [coldOpenCode, setColdOpenCode] = useState(
    ENABLE_ONLINE ? parseHashCode() : null,
  );
  // Inputs from a join attempt the server rejected (issue #14). When set, the
  // start screen renders in JOIN mode with these pre-filled so the user can
  // tweak the name and retry without losing context.
  const [pendingDisplayName, setPendingDisplayName] = useState('');
  const [pendingCode, setPendingCode] = useState('');

  async function handleCreateOnline({ displayName, magicItems }) {
    // Synchronous call inside the click handler chain so iOS Safari counts
    // this as a user gesture and lets us create/resume the AudioContext.
    // Without it the joiner (and sometimes the host) gets no bg music until
    // their next tap (issue #6). For the host, the lobby's "Start game"
    // button also calls resumeAudio — this is a second belt-and-braces.
    sounds.resumeAudio();
    setOnlineError(null);
    setPendingDisplayName('');
    setPendingCode('');
    try {
      const res = await fetch(`${SERVER_URL}/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body = await res.json();
      setColdOpenCode(null);
      setOnline({ code: body.code, displayName, magicItems });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setOnlineError(`Couldn't reach the server: ${reason}`);
    }
  }

  function handleJoinOnline({ displayName, code }) {
    // Same iOS-gesture rationale as handleCreateOnline. Critical for the
    // joiner — JOIN ROOM is their last user gesture before the host starts
    // the game; without resumeAudio here their AudioContext never exists
    // and bg music silently fails to start (issue #6).
    sounds.resumeAudio();
    setOnlineError(null);
    setColdOpenCode(null);
    setPendingDisplayName('');
    setPendingCode('');
    // Joiner's initial magic-items choice is irrelevant — host decides.
    // Default false just so the lobby has a concrete value.
    setOnline({ code, displayName, magicItems: false });
  }

  // OnlineGameController calls this when the WS handshake fails with one of
  // the routable codes. We tear down the online session and re-render the
  // start screen in JOIN mode with the rejected inputs preserved + an
  // inline error explaining what to fix.
  function handleJoinFailed({ code }) {
    if (online) {
      setPendingDisplayName(online.displayName);
      setPendingCode(online.code);
    }
    setOnline(null);
    setOnlineError(ROUTABLE_JOIN_ERRORS[code] ?? `Error: ${code}`);
    clearRoomHash();
  }

  function handleOnlineExit() {
    setOnline(null);
    setOnlineError(null);
    setPendingDisplayName('');
    setPendingCode('');
    clearRoomHash();
  }

  if (ENABLE_ONLINE && online && OnlineGameController) {
    return (
      <Suspense fallback={null}>
        <OnlineGameController
          code={online.code}
          displayName={online.displayName}
          initialMagicItems={online.magicItems}
          onExit={handleOnlineExit}
          onJoinFailed={handleJoinFailed}
        />
      </Suspense>
    );
  }

  // Effective default-mode + defaults. A pending failed-join takes priority
  // over a cold-open hash code; both fall back to the hotseat default.
  const effectiveDefaultCode = pendingCode || coldOpenCode || '';
  const effectiveDefaultMode =
    pendingCode || (ENABLE_ONLINE && coldOpenCode) ? 'join' : 'this-device';

  return (
    <LocalGameController
      onCreateOnline={ENABLE_ONLINE ? handleCreateOnline : null}
      onJoinOnline={ENABLE_ONLINE ? handleJoinOnline : null}
      defaultMode={effectiveDefaultMode}
      defaultCode={effectiveDefaultCode}
      defaultDisplayName={pendingDisplayName}
      onlineError={onlineError}
    />
  );
}
