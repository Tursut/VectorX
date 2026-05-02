import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import './index.css'
import App from './App.jsx'

// PostHog project API key is public by design — safe to embed in source.
// VITE_POSTHOG_KEY env var overrides this (useful for forks / CI).
posthog.init(import.meta.env.VITE_POSTHOG_KEY || 'phc_s59K2SNa6Rv3bCd8A3fRYZXc6ekGNVwFq25AUoaycckD', {
  api_host: 'https://eu.i.posthog.com',
  capture_pageview: false,
  capture_pageleave: false,
  autocapture: false,
  disable_session_recording: true,
  persistence: 'localStorage',
  bootstrap: { featureFlags: {} },
  loaded: (ph) => {
    if (typeof window !== 'undefined') window.posthog = ph;
    // eslint-disable-next-line no-console
    console.log('[posthog] loaded — try posthog.capture("manual_test")');
  },
})
if (typeof window !== 'undefined') window.posthog = posthog;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
