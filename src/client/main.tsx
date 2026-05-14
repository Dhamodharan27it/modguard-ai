import { createRoot } from 'react-dom/client';
import { App } from './App';

// Mount the ModGuard AI dashboard into the page
const root = document.getElementById('root') ?? document.body;
createRoot(root).render(<App />);
