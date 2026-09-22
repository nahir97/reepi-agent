/**
 * Entry point. Mounts the studio into `#root`.
 *
 * `index.html` has already applied the persisted theme from
 * `localStorage["reepi.theme"]` before first paint, so there is nothing to do
 * here but import the stylesheet and render.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
