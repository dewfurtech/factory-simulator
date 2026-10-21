import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.DEV) {
  void Promise.all([import('./store/project'), import('./store/ui')]).then(([p, u]) => {
    Object.assign(window, { __factory: { project: p.useProject, ui: u.useUi } });
  });
}
