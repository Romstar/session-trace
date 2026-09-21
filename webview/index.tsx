import { createRoot } from 'react-dom/client';
import xyflowCss from '@xyflow/react/dist/style.css';
import appCss from './styles.css';
import { App } from './App';

const style = document.createElement('style');
style.textContent = `${xyflowCss}\n${appCss}`;
document.head.appendChild(style);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
