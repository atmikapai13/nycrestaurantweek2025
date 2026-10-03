import { useEffect, useState } from "react";

const QUERY = "(min-width: 769px)";

/** True above the 768px mobile breakpoint; updates when the window crosses it. */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === "undefined" ? true : window.matchMedia(QUERY).matches
  );
  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const onChange = () => setIsDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}
