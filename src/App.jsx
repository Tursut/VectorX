import { useState } from 'react';
import { ENABLE_ONLINE } from './config';
import LocalGameController from './LocalGameController';
import OnlineGameController from './OnlineGameController';
import './App.css';

// Thin mode router. Local play is the only path today; the online branch is
// gated by the build-time `VITE_ENABLE_ONLINE` flag so it tree-shakes out of
// production bundles until Step 18 flips the flag on. Step 16 will expose
// setMode through StartScreen; until then `mode` stays 'local'.
export default function App() {
  const [mode] = useState('local');

  if (ENABLE_ONLINE && mode === 'online') {
    return <OnlineGameController />;
  }
  return <LocalGameController />;
}
