// React hook that intercepts the browser/system back button so the user
// can be asked "are you sure?" before losing in-progress state.
//
// Standard popstate sentinel-entry trick: while `active` is true, push
// an extra history entry on mount so the next back press fires
// `popstate` instead of leaving the page. On popstate we run `onBack`
// (typically opens an exit-confirm modal or routes to a safe place)
// and immediately re-push the sentinel so subsequent back presses are
// also intercepted.
//
// `onBack` is read through a ref so the popstate listener doesn't churn
// on every prop change of the latest callback closure.
//
// Used by LocalGameController + OnlineGameController to gate the
// browser-back from silently destroying a running game (issue #29).
//
// @param {boolean} active   When true, the guard is installed. When
//                           false, any installed listener is removed.
// @param {() => void} onBack Fired when the user presses back while the
//                           guard is active.

import { useEffect, useRef } from 'react';

export function useBackGuard(active, onBack) {
  const onBackRef = useRef(onBack);
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) return;
    if (typeof window === 'undefined' || !window.history) return;

    // Sentinel so the first back press hits popstate instead of leaving.
    window.history.pushState({ vxBackGuard: true }, '');

    function handle() {
      try {
        onBackRef.current?.();
      } catch (err) {
        // A throwing callback shouldn't break the guard. Log and re-arm
        // the sentinel so the next back press is still intercepted.
        // eslint-disable-next-line no-console
        console.warn('[useBackGuard] onBack threw', err);
      }
      // Push another sentinel so the user is still protected on the
      // next back press (e.g. they hit "Keep playing" in a confirm
      // modal and then immediately press back again).
      window.history.pushState({ vxBackGuard: true }, '');
    }

    window.addEventListener('popstate', handle);
    return () => window.removeEventListener('popstate', handle);
  }, [active]);
}
