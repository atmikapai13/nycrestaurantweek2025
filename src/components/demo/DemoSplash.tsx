import { useEffect, useState } from 'react';
import './DemoSplash.css';

/**
 * DemoSplash - Animated splash screen for demo video recording
 *
 * Animation sequence:
 * 1. Show Remi + "nyceats.live" text centered (1 second pause)
 * 2. Text slides left, disappearing behind Remi (2-3 seconds)
 * 3. Freeze with just Remi visible
 *
 * Access via /demo route
 */
export default function DemoSplash() {
  const [animationStarted, setAnimationStarted] = useState(false);

  useEffect(() => {
    // Start animation after 1 second pause
    const timer = setTimeout(() => {
      setAnimationStarted(true);
    }, 1000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="demo-splash">
      <div className="demo-splash-content">
        {/* Remi image - stays in place, higher z-index */}
        <div className="demo-remi-container">
          <img
            src="/remi_transparent.png"
            alt="Remi"
            className="demo-remi-image"
          />
        </div>

        {/* Text container - slides left behind Remi */}
        <div className={`demo-text-container ${animationStarted ? 'animate-out' : ''}`}>
          <span className="demo-text-nyc">nyc</span>
          <span className="demo-text-eats">eats</span>
          <span className="demo-text-live">.live</span>
        </div>
      </div>
    </div>
  );
}
