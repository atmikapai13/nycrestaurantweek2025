import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMap } from "../contexts/MapContext";
import RemiBubble from "./RemiBubble";
import { Button } from "@/components/ui/button";
import "./MobileOnboarding.css";

const MS_PER_CHAR = 45; // classic Game Boy/Pokémon dialogue-box pace
/** After the last line finishes typing, wait this long before the chat drawer slides up */
const LAST_STEP_PAUSE_MS = 700;
/** How long the card takes to fade out (matches .mobile-onboarding--leaving) */
const LEAVE_MS = 250;

type Segment = { text: string; highlight?: boolean };

interface Step {
  body: Segment[];
  /** Points a pulsing ring and bouncing arrow at this element ([data-onboarding="…"]) */
  target?: "filter";
}

const STEPS: Step[] = [
  { body: [{ text: "Hey, I'm Remi! I can help you find restaurants in NYC." }] },
  {
    target: "filter",
    body: [{ text: "Tap above to " }, { text: "filter", highlight: true }, { text: " restaurants." }],
  },
  { body: [{ text: "Or " }, { text: "chat with me", highlight: true }, { text: "!" }] },
];

const totalLength = (body: Segment[]) => body.reduce((sum, seg) => sum + seg.text.length, 0);

function renderTyped(body: Segment[], charsShown: number): ReactNode[] {
  let remaining = charsShown;
  return body.map((seg, i) => {
    const shown = seg.text.slice(0, Math.max(0, remaining));
    remaining -= seg.text.length;
    return shown ? (
      <span key={i} className={seg.highlight ? "mobile-onboarding-highlight" : undefined}>
        {shown}
      </span>
    ) : null;
  });
}

/**
 * Mobile first-visit walkthrough (once per browser): Remi types three short lines in a card over
 * the map — who he is, the Filter button (ring + arrow), then "Or chat with me!", after which
 * the chat drawer (hidden until then) slides up. Tap to finish a line, tap again to go on.
 * Skip, or tapping Filter, ends it early.
 */
export default function MobileOnboarding() {
  const { onboardingActive, finishOnboarding } = useMap();
  const [phase, setPhase] = useState<"tour" | "leaving" | "done">(onboardingActive ? "tour" : "done");
  const [index, setIndex] = useState(0);
  const [charsShown, setCharsShown] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const step = STEPS[index];
  const length = totalLength(step.body);
  const isTyping = charsShown < length;
  const isLast = index === STEPS.length - 1;

  const finish = useRef(() => {});
  finish.current = () => {
    if (phase !== "tour") return;
    setPhase("leaving");
    finishOnboarding(); // the drawer starts sliding up while the card fades out
    setTimeout(() => setPhase("done"), LEAVE_MS);
  };

  // Ended elsewhere (e.g. the Filter button was tapped)
  useEffect(() => {
    if (!onboardingActive && phase === "tour") {
      setPhase("leaving");
      setTimeout(() => setPhase("done"), LEAVE_MS);
    }
  }, [onboardingActive, phase]);

  // Type the current line out one character at a time (handleTap resets the count with the line)
  useEffect(() => {
    if (phase !== "tour") return;
    const timer = setInterval(() => {
      setCharsShown((c) => {
        if (c + 1 >= length) clearInterval(timer);
        return c + 1;
      });
    }, MS_PER_CHAR);
    return () => clearInterval(timer);
  }, [index, length, phase]);

  // The last line hands over to the chat on its own once it's typed
  useEffect(() => {
    if (!isLast || isTyping || phase !== "tour") return;
    const timer = setTimeout(() => finish.current(), LAST_STEP_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [isLast, isTyping, phase]);

  // Where the pointed-at element is (re-measured on resize / rotation)
  useLayoutEffect(() => {
    if (!step.target) {
      setTargetRect(null);
      return;
    }
    const measure = () =>
      setTargetRect(document.querySelector(`[data-onboarding="${step.target}"]`)?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step.target]);

  if (phase === "done") return null;

  // Mid-type a tap finishes the line; after that it moves on (or, on the last line, opens the chat)
  const handleTap = () => {
    if (phase !== "tour") return;
    if (isTyping) {
      setCharsShown(length);
    } else if (isLast) {
      finish.current();
    } else {
      setCharsShown(0);
      setIndex((i) => i + 1);
    }
  };

  return (
    <>
      {/* Catches taps on the map so they advance the walkthrough (Filter and the card sit above it) */}
      <div className="mobile-onboarding-catcher" onClick={handleTap} aria-hidden="true" />

      {targetRect && phase === "tour" && !isTyping && (
        <>
          <div
            className="mobile-onboarding-ring"
            style={{
              top: targetRect.top - 4,
              left: targetRect.left - 4,
              width: targetRect.width + 8,
              height: targetRect.height + 8,
            }}
            aria-hidden="true"
          />
          <div
            className="mobile-onboarding-arrow"
            style={{ top: targetRect.bottom + 10, left: targetRect.left + targetRect.width / 2 }}
            aria-hidden="true"
          >
            <ArrowUp className="size-6" strokeWidth={3} />
          </div>
        </>
      )}

      <div className={`mobile-onboarding${phase === "leaving" ? " mobile-onboarding--leaving" : ""}`}>
        <div className="mobile-onboarding-inner">
          {/* The same bubble as Remi's chat messages, so the drawer that follows reads as the
              same conversation, with a pink border and a stronger shadow to lift it off the map */}
          <div
            className="mobile-onboarding-card"
            onClick={handleTap}
            role="button"
            tabIndex={0}
            aria-label={isLast ? undefined : "Continue"}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") handleTap();
            }}
          >
            <RemiBubble className="border-2 !border-pink/40 shadow-lg">
              <p className="mobile-onboarding-text">
                {renderTyped(step.body, charsShown)}
                {isTyping && <span className="mobile-onboarding-cursor" />}
              </p>
              {/* "Tap to continue" once the line is typed (like the ▼ in a Game Boy dialogue box);
                  its row is always there so the bubble doesn't jump. The last line moves on by itself. */}
              <div className="-mt-2 flex justify-end" aria-hidden="true">
                <ChevronsRight
                  className={cn("mobile-onboarding-next size-5", (isTyping || isLast) && "invisible")}
                  strokeWidth={2.5}
                />
              </div>
            </RemiBubble>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mobile-onboarding-skip h-7 rounded-full px-3 text-xs"
            onClick={() => finish.current()}
          >
            Skip
          </Button>
        </div>
      </div>
    </>
  );
}
