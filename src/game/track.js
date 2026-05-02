import mixpanel from 'mixpanel-browser';

// Fire-and-forget event wrapper around Mixpanel.
// If Mixpanel fails to load, is blocked, or throws, the game is unaffected.
export function track(event, props = {}) {
  try {
    mixpanel.track(event, props);
  } catch {
    // swallow — analytics must never break gameplay
  }
}
