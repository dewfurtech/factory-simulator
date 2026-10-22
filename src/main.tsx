import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { DialogHost } from './ui/Dialog';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <DialogHost />
    </ErrorBoundary>
  </StrictMode>,
);

if (import.meta.env.DEV) {
  void Promise.all([import('./store/project'), import('./store/ui')]).then(([p, u]) => {
    Object.assign(window, { __factory: { project: p.useProject, ui: u.useUi } });
  });
}
