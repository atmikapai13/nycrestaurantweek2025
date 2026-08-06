import * as React from "react"

// Above a normal desktop viewport (e.g. large/ultra-wide monitors) — matches
// Tailwind's `2xl` breakpoint.
const LARGE_SCREEN_BREAKPOINT = 1536

export function useIsLargeScreen() {
  const [isLargeScreen, setIsLargeScreen] = React.useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth >= LARGE_SCREEN_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LARGE_SCREEN_BREAKPOINT}px)`)
    const onChange = () => {
      setIsLargeScreen(window.innerWidth >= LARGE_SCREEN_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsLargeScreen(window.innerWidth >= LARGE_SCREEN_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isLargeScreen
}
