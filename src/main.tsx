import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import Admin from './Admin';
createRoot(document.getElementById('root')!).render(location.hash === '/admin' ? <Admin /> : <App />);
