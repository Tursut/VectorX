import { useEffect } from 'react';

// Toggle body[data-bg-hidden] so a single MenuAvatarStage hoisted to the
// App level can be hidden when the active screen needs focus (active game
// board, fatal error). One bg mount + a CSS-driven fade keeps the bubble
// drift continuous across screen changes — they don't reset their staggered
// timers when the user moves between start, lobby, gameover, etc.
export function useBgHidden(hidden) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (hidden) {
      document.body.dataset.bgHidden = 'true';
    } else {
      delete document.body.dataset.bgHidden;
    }
    return () => {
      delete document.body.dataset.bgHidden;
    };
  }, [hidden]);
}
