import { lazy, Suspense, useState } from 'react';
import { ENABLE_ONLINE, SERVER_URL } from './config';
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

export default function App() {
  // { code, displayName, magicItems } when we're in an active online session,
  // null otherwise. Setting this transitions the whole app to OnlineGameController.
  const [online, setOnline] = useState(null);
  // Transient error shown on StartScreen — e.g. POST /rooms failed.
  const [onlineError, setOnlineError] = useState(null);
  // Hash-prefilled code. Null after any transition so refreshes don't loop.
  const [coldOpenCode, setColdOpenCode] = useState(
    ENABLE_ONLINE ? parseHashCode() : null,
  );

  async function handleCreateOnline({ displayName, magicItems }) {
    setOnlineError(null);
    try {
      const res = await fetch(`${SERVER_URL}/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const body = await res.json();
      setColdOpenCode(null);
      setOnline({ code: body.code, displayName, magicItems });
    } catch (err) {
      setOnlineError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleJoinOnline({ displayName, code }) {
    setOnlineError(null);
    setColdOpenCode(null);
    // Joiner's initial magic-items choice is irrelevant — host decides.
    // Default false just so the lobby has a concrete value.
    setOnline({ code, displayName, magicItems: false });
  }

  function handleOnlineExit() {
    setOnline(null);
    setOnlineError(null);
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
        />
      </Suspense>
    );
  }

  return (
    <LocalGameController
      onCreateOnline={ENABLE_ONLINE ? handleCreateOnline : null}
      onJoinOnline={ENABLE_ONLINE ? handleJoinOnline : null}
      defaultMode={ENABLE_ONLINE && coldOpenCode ? 'online' : 'same-device'}
      defaultCode={coldOpenCode ?? ''}
      onlineError={onlineError}
    />
  );
}
