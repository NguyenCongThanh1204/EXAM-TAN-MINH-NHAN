import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import Admin from './AdminPanel';
import { UiProvider } from './ui';
createRoot(document.getElementById('root')!).render(<UiProvider>{location.hash === '#/admin' ? <Admin /> : <App />}</UiProvider>);
