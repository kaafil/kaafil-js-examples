import * as React from 'react';
import { createRoot } from 'react-dom/client';
import './global.css';
import { App } from './App.js';
import { ErrorBoundary } from './ui/ErrorBoundary.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

createRoot(container).render(
  <React.StrictMode>
    {/* The app-shell-level net: catches anything that throws before a
        per-view boundary would ever see it (renderVals() itself, the nav
        shell, …). MethodScreen.tsx's own ErrorBoundary around <Views/> is
        the one that actually fires for the common case (one result view's
        render logic choking on a shape it did not expect) — this one exists
        so ANY other render bug degrades to an inline message too, never a
        blank page. No onReset here (there is no shared state to clear from
        outside <App/>): "Reset view" just remounts the whole shell fresh. */}
    <ErrorBoundary label="The playground">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
