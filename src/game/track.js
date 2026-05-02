// Fire-and-forget event wrapper around PostHog.
// If PostHog fails to load, is blocked, or throws, the game is unaffected.
export function track(event, props = {}) {
  try {
    if (typeof window === 'undefined') return;
    if (!window.posthog?.__loaded) return;
    window.posthog.capture(event, props);
  } catch {
    // swallow — analytics must never break gameplay
  }
}
