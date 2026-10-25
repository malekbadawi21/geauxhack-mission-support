// main.tsx — the browser entry point: loads fonts and styles, then renders <App /> into index.html.
//
// How it fits: index.html loads this file; it mounts the React app into the #root div. Fonts come
// from @fontsource packages bundled with the app (no font CDN or other network loading). Each import
// is one weight's CSS + font files; Latin subsets only to keep the bundle small.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './styles/app.css'
import App from './App.tsx'

// The `!` tells TypeScript the #root element exists (it is in index.html). StrictMode runs extra
// development-only checks; it changes nothing in the production build.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
