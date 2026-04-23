import { lazy, Suspense, useState } from 'react';
import { ENABLE_ONLINE } from './config';
import LocalGameController from './LocalGameController';
import './App.css';

// Thin mode router between hotseat and online play. Online is gated by the
// build-time `VITE_ENABLE_ONLINE` flag so the whole branch tree-shakes out of
// production bundles until Step 18 flips the flag on. The lazy() + conditional
// ternary below keeps the dynamic `import('./OnlineGameController')` call
// behind a statically-false branch when the flag is off, so Rollup drops the
// whole online subtree (including its transitive zod + createClient deps) —
// the flag-off production bundle stays byte-identical to Step 15.
const OnlineGameController = ENABLE_ONLINE
  ? lazy(() => import('./OnlineGameController'))
  : null;

export default function App() {
  const [mode, setMode] = useState('local');

  if (ENABLE_ONLINE && mode === 'online' && OnlineGameController) {
    return (
      <Suspense fallback={null}>
        <OnlineGameController onExit={() => setMode('local')} />
      </Suspense>
    );
  }
  return (
    <LocalGameController
      onGoOnline={ENABLE_ONLINE ? () => setMode('online') : null}
    />
  );
}
