import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import mixpanel from 'mixpanel-browser'
import './index.css'
import App from './App.jsx'

// Project token is public by design — safe to embed in frontend source.
mixpanel.init('cafa8f66569f86a476bac0b3c1d0c17b', {
  api_host: 'https://api-eu.mixpanel.com',
  track_pageview: false,
  persistence: 'localStorage',
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
