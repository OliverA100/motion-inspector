import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StaticLayout } from '@motion-inspector/editor';

const container = document.getElementById('app');
if (container === null) throw new Error('Missing #app');

// For now the page shows the static layout. "?compare=side-by-side" shows
// the other compare mode, for screenshots.
const compare =
  new URLSearchParams(window.location.search).get('compare') === 'side-by-side'
    ? 'side-by-side'
    : 'overlay';

createRoot(container).render(
  <StrictMode>
    <StaticLayout compare={compare} />
  </StrictMode>,
);
