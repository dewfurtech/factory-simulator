import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { DialogHost } from './ui/Dialog';
import './styles.css';

// The app's script arrived: the loading watchdog in index.html stands down.
(window as unknown as { __booted?: boolean }).__booted = true;
try {
  sessionStorage.removeItem('boot-retry');
} catch {
  /* storage blocked: nothing to clear */
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <DialogHost />
    </ErrorBoundary>
  </StrictMode>,
);

// The stores on window for the console and the browser tests (built with --mode e2e).
if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
  void Promise.all([import('./store/project'), import('./store/ui')]).then(([p, u]) => {
    // `openFlow` opens the AI picture dialog while its buttons are switched off (AI_PICTURES in src/ui/FlowDialog.tsx).
    const openFlow = () => import('./ui/FlowDialog').then((f) => f.openFlowDialog());
    Object.assign(window, { __factory: { project: p.useProject, ui: u.useUi, openFlow } });
  });
}
