import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import posthog from 'posthog-js'
import './index.css'
import App from './App.jsx'

// Project API key is public by design — safe to embed in frontend source.
// VITE_POSTHOG_KEY env var overrides this (useful for forks or CI).
posthog.init(import.meta.env.VITE_POSTHOG_KEY || 'phc_s59K2SNa6Rv3bCd8A3fRYZXc6ekGNVwFq25AUoaycckD', {
  api_host: 'https://us.i.posthog.com',
  capture_pageview: false,
  capture_pageleave: false,
  autocapture: false,
  persistence: 'localStorage',
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
