import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyTheme, preferredTheme } from './lib/theme.js';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('The dashboard root element is missing from index.html.');

// Applied before the first render: the saved theme is what the mount paints, so a
// light-theme customer never sees the navy canvas first. This lives here rather
// than in an inline <script> because the server's CSP refuses inline scripts.
applyTheme(preferredTheme());

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
