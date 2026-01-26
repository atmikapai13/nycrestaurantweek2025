import { useEffect, useRef } from "react";
import "./Snow.css";

const SNOWFLAKE_COUNT = 100;

export default function Snow() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create snowflakes
    for (let i = 0; i < SNOWFLAKE_COUNT; i++) {
      const snowflake = document.createElement("div");
      snowflake.className = "snowflake";
      snowflake.innerHTML = "&#10052;"; // Unicode snowflake

      // Random properties
      const size = Math.random() * 12 + 10; // 10-22px
      const left = Math.random() * 100; // 0-100%
      const animationDuration = Math.random() * 5 + 6; // 6-11s (faster)
      const animationDelay = Math.random() * -10; // Stagger start times
      const opacity = Math.random() * 0.3 + 0.6; // 0.6-0.9 (more visible)

      snowflake.style.fontSize = `${size}px`;
      snowflake.style.left = `${left}%`;
      snowflake.style.animationDuration = `${animationDuration}s`;
      snowflake.style.animationDelay = `${animationDelay}s`;
      snowflake.style.opacity = `${opacity}`;

      container.appendChild(snowflake);
    }

    // Cleanup on unmount
    return () => {
      while (container.firstChild) {
        container.removeChild(container.firstChild);
      }
    };
  }, []);

  return <div ref={containerRef} className="snow-container" />;
}
