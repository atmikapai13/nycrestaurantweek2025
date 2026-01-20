import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import DemoSplash from './components/demo/DemoSplash.tsx'
import DemoMapFlyover from './components/demo/DemoMapFlyover.tsx'

// Simple path-based routing for demo pages
const pathname = window.location.pathname;
const isDemoSplash = pathname === '/demo' || pathname === '/demo/';
const isDemoFlyover = pathname === '/demo/flyover' || pathname === '/demo/flyover/';

const getComponent = () => {
  if (isDemoSplash) return <DemoSplash />;
  if (isDemoFlyover) return <DemoMapFlyover />;
  return <App />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {getComponent()}
  </StrictMode>,
)
