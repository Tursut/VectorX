import posthog from 'posthog-js';

// Fire-and-forget wrapper. If PostHog hasn't initialised or throws,
// the game is completely unaffected.
export function track(event, props = {}) {
  try {
    if (!posthog.__loaded) return;
    posthog.capture(event, props);
  } catch {
    // swallow — analytics must never break gameplay
  }
}
