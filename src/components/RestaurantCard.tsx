import { useState } from "react";
import { ChevronDown, Globe, Heart, Phone, X } from "lucide-react";
import RatingArc from "./RatingArc";
import type { Restaurant } from "../types/restaurant";
import { asset } from "../utils/asset";
import { displayName } from "../utils/restaurantName";
import TravelTimes, { SECTION_LABEL } from "./TravelTimes";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface RestaurantCardProps {
  restaurant: Restaurant | null;
  placeholderRestaurant?: Restaurant | null;
  onClose?: () => void;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
  onRequestReviewHighlights?: (prompt: string, slug: string) => void;
  onExpandDrawer?: () => void;
  /** Remi's pick number (1-based) when this is one of his picks: shown in a strip at the top */
  pickNumber?: number;
}

const MICHELIN_STARS = ["ONE_STAR", "TWO_STARS", "THREE_STARS"];

/** Split text into paragraphs of two sentences (dropping Yelp's "Yelp categorizes…" opener). */
function paragraphs(text: string | undefined, dropYelpOpener = false): string {
  if (!text) return "";
  let sentences = text.split(". ");
  if (dropYelpOpener && sentences[0]?.startsWith("Yelp categorizes")) sentences = sentences.slice(1);
  return sentences.reduce((acc, sentence, i, all) => {
    const s = i === all.length - 1 && sentence.endsWith(".") ? sentence : `${sentence}.`;
    return i === 0 ? s : acc + (i % 2 === 0 ? "\n\n" : " ") + s;
  }, "");
}

/** Source logo sitting inline at the start of review text, like the first word. */
function SourceIcon({ src, label }: { src: string; label: string }) {
  return <img src={src} alt={label} title={label} className="mr-1 inline-block size-3.5 object-contain align-[-2px]" />;
}

/** Pastel info badge: pill-shaped, no border, not clickable (buttons are bordered and square-ish). */
const TAG_COLORS = {
  peach: "bg-peach hover:bg-peach",
  butter: "bg-butter hover:bg-butter",
  lavender: "bg-lavender hover:bg-lavender",
} as const;

function Tag({ color, children }: { color: keyof typeof TAG_COLORS; children: React.ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "cursor-default select-none gap-1 rounded-full border-transparent px-2 py-0 text-caption font-medium text-foreground",
        TAG_COLORS[color]
      )}
    >
      {children}
    </Badge>
  );
}

/** Outlined square icon button next to Reserve (label shows on hover / for screen readers). */
function ActionIcon({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  const external = !href.startsWith("tel:");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="outline" size="icon" className="size-8 shrink-0 rounded-md [&_svg]:size-3.5">
          <a href={href} aria-label={label} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {children}
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="z-[2000] bg-foreground font-sans text-caption text-background">{label}</TooltipContent>
    </Tooltip>
  );
}

/** 1507 → "1.5k", 12345 → "12k", 233 → "233" */
function compactCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k < 10 ? k.toFixed(1).replace(/\.0$/, "") : Math.round(k)}k`;
}

// Brand icons (lucide no longer ships these)
const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
  </svg>
);

export default function RestaurantCard({
  restaurant,
  placeholderRestaurant,
  onClose,
  isFavorited = false,
  onToggleFavorite,
  onExpandDrawer,
  pickNumber,
}: RestaurantCardProps) {
  const [showMore, setShowMore] = useState(false);
  // Open section inside Reviews & more: "reviews", "about" or "" (none)
  const [openSection, setOpenSection] = useState("");
  const r = restaurant || placeholderRestaurant;
  if (!r) return null;

  const reason = r.match_reason;
  const hasYelp = !!r.yelp_rating && !!r.yelp_review_count;
  const reserveUrl = r.table_res?.trim()
    ? r.table_res
    : r.opentable_id
      ? `https://www.opentable.com/restaurant/profile/${r.opentable_id}`
      : null;
  const mainAction = reserveUrl
    ? { href: reserveUrl, label: "Reserve a table" }
    : r.website?.trim()
      ? { href: r.website, label: "Visit website" }
      : null;
  const isStarred = !!r.michelin_award && MICHELIN_STARS.includes(r.michelin_award);
  const isBib = r.michelin_award === "BIB_GOURMAND";
  const hasReviews = !!r.yelp_review_highlights || !!r.reddit?.trim();
  // Preview: Yelp's highlights minus the "Yelp categorizes…" opener and "In Yelp reviews," lead-in
  const reviewPreview = (() => {
    const text = paragraphs(r.yelp_review_highlights, true).replace(/\s+/g, " ").trim() || r.reddit?.trim() || "";
    const t = text.replace(/^In Yelp reviews,\s*/i, "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();
  // About: collapsed shows the one-line pitch (summary); expanded shows the longer write-up
  // (summary2), which often restates the pitch, so the two are never shown together. When
  // Remi's quote already is the pitch, the preview uses the write-up instead.
  const shortAbout = r.summary?.trim() ?? "";
  const longAbout = r.summary2?.trim() || shortAbout;
  const hasDetails = hasReviews || !!longAbout;

  // Remi's reason (his picks): the quote in full, then the facts. Only when there's a quote: the
  // facts alone ("Italian") just repeat the search's filters and the card's tags
  const whyBlock = reason?.quote && (
    <div className="border-l-2 border-primary py-1 pl-2.5">
      {reason.quote && (
        <blockquote className="text-body italic text-muted-foreground">
          “{reason.quote.text}”
          <span className="whitespace-nowrap text-caption not-italic text-grey"> — {reason.quote.source}</span>
        </blockquote>
      )}
      {reason.facts.length > 0 && (
        <div className={cn("text-body font-semibold text-foreground", reason.quote && "mt-1")}>
          {reason.facts.map((fact) => (
            <div key={fact}>{fact}</div>
          ))}
        </div>
      )}
    </div>
  );

  // What it is (name, cuisine / price / award tags) and is it good (star arc, top-right)
  const header = (
    <CardHeader className={cn("flex flex-row items-start gap-3 p-4 pb-3", onClose && "pr-10")}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <CardTitle className="text-heading font-bold leading-[1.2] tracking-tight max-md:text-[19px]" title={r.name}>
          {displayName(r.name)}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {r.cuisine && (
            <Tag color="peach">
              {r.cuisine}
            </Tag>
          )}
          {r.price && (
            <Tag color="butter">
              {r.price}
            </Tag>
          )}
          {isStarred && (
            <Tag color="lavender">
              <img src={asset("/MichelinStar.svg.png")} alt="" className="size-3.5" /> Michelin
            </Tag>
          )}
          {isBib && (
            <Tag color="lavender">
              <img src={asset("/bibgourmand.png")} alt="" className="size-3.5" /> Bib Gourmand
            </Tag>
          )}
          {r.nyttop100_rank && (
            <Tag color="lavender">
              <img src={asset("/nytimes.png")} alt="" className="size-3.5" /> NYT #{r.nyttop100_rank}
            </Tag>
          )}
        </div>
      </div>
      {hasYelp && (
        <RatingArc size="sm" rating={r.yelp_rating!} reviews={`${compactCount(r.yelp_review_count!)} reviews`} />
      )}
    </CardHeader>
  );

  // Act on it, across the full width: one solid main action (Reserve, or the website when
  // there's no booking link), then website / Instagram / call / save as icon buttons
  const actions = (
    <div className="flex items-center gap-1.5">
      {mainAction && (
        <Button asChild className="h-8 flex-1 rounded-md bg-foreground text-label font-semibold text-background hover:bg-foreground/85">
          <a href={mainAction.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            {mainAction.label}
          </a>
        </Button>
      )}
      {reserveUrl && r.website?.trim() && (
        <ActionIcon href={r.website} label="Website">
          <Globe />
        </ActionIcon>
      )}
      {r.instagram_url?.trim() && (
        <ActionIcon href={r.instagram_url} label="Instagram">
          <InstagramIcon />
        </ActionIcon>
      )}
      {r.telephone?.trim() && (
        <ActionIcon href={`tel:${r.telephone}`} label={`Call ${r.telephone}`}>
          <Phone />
        </ActionIcon>
      )}
      {onToggleFavorite && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="size-8 shrink-0 rounded-md"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
              aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
              aria-pressed={isFavorited}
            >
              <Heart className={cn("!size-3.5 text-pink-light", isFavorited && "fill-pink-light")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent className="z-[2000] bg-foreground font-sans text-caption text-background">
            {isFavorited ? "Unfavorite" : "Favorite"}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );


  // Inside "Reviews & more": Reviews (two-line preview, opens to the full text) and About,
  // one open at a time; on mobile the chat drawer grows to make room
  const details = (
    <Accordion
      type="single"
      collapsible
      value={openSection}
      onValueChange={(open) => {
        setOpenSection(open);
        if (open) onExpandDrawer?.();
      }}
    >
      {hasReviews && (
        <AccordionItem value="reviews" className="border-grey-light last:border-b-0">
          <AccordionTrigger className="items-start gap-3 py-2.5 hover:no-underline [&>svg]:mt-0.5">
            <span className="flex min-w-0 flex-col items-start gap-1 text-left">
              <span className={SECTION_LABEL}>Reviews</span>
              {openSection !== "reviews" && reviewPreview && (
                <span className="line-clamp-2 text-body font-normal text-muted-foreground">
                  <SourceIcon src={asset(r.yelp_review_highlights ? "/yelp_logo.png" : "/reddit.webp")} label={r.yelp_review_highlights ? "Yelp" : "Reddit"} />
                  {reviewPreview}
                </span>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className="flex flex-col gap-3 pb-3">
            {r.yelp_review_highlights && (
              <p className="whitespace-pre-line text-body text-muted-foreground">
                <SourceIcon src={asset("/yelp_logo.png")} label="Yelp" />
                {paragraphs(r.yelp_review_highlights, true).replace(/^In Yelp reviews,\s*(.)/i, (_, c: string) => c.toUpperCase())}
              </p>
            )}
            {r.reddit?.trim() && (
              <p className="whitespace-pre-line text-body text-muted-foreground">
                <SourceIcon src={asset("/reddit.webp")} label="Reddit" />
                {paragraphs(r.reddit)}
              </p>
            )}
            {r.yelp_url?.trim() && (
              <div className="self-end">
                <ActionIcon href={r.yelp_url} label="Open Yelp">
                  <img src={asset("/yelp_logo.png")} alt="" className="size-4 object-contain" />
                </ActionIcon>
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      )}
      {longAbout && (
        <AccordionItem value="about" className="border-grey-light last:border-b-0">
          <AccordionTrigger className={cn("py-2.5 hover:no-underline", SECTION_LABEL)}>About</AccordionTrigger>
          <AccordionContent className="flex flex-col gap-2 pb-3">
            <p className="whitespace-pre-line text-body text-muted-foreground">{paragraphs(longAbout)}</p>
            {(r.michelin_award || r.nyttop100_rank) && (
              <div className="flex justify-end gap-1.5">
                {r.michelin_award && (
                  <ActionIcon
                    href={
                      r.michelin_url ||
                      `https://guide.michelin.com/en/new-york-state/new-york/restaurant/${r.michelin_slug || r.slug}`
                    }
                    label="Michelin Guide"
                  >
                    <img src={asset(isBib ? "/bibgourmand.png" : "/MichelinStar.svg.png")} alt="" className="size-4 object-contain" />
                  </ActionIcon>
                )}
                {r.nyttop100_rank && (
                  <ActionIcon
                    href={
                      r.nyt_url ||
                      `https://www.nytimes.com/interactive/2025/dining/best-nyc-restaurants.html#${r.name
                        .toLowerCase()
                        .replace(/[^a-z0-9\s-]/g, "")
                        .replace(/\s+/g, "-")}`
                    }
                    label="NYT Top 100"
                  >
                    <img src={asset("/nytimes.png")} alt="" className="size-4 object-contain" />
                  </ActionIcon>
                )}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      )}
    </Accordion>
  );

  return (
    <TooltipProvider delayDuration={200}>
    <Card className="restaurant-card tw-reset relative w-full gap-0 overflow-hidden border-foreground py-0 font-sans text-foreground shadow-md">
      {/* Close (when shown in a popup) */}
      <div className={cn("absolute right-2 flex items-center", pickNumber ? "top-0" : "top-2")}>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-7 text-grey hover:bg-transparent hover:text-muted-foreground",
              // On the black pick strip
              pickNumber && "size-6 text-background/70 hover:text-background [&_svg]:!size-3.5"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close"
          >
            <X className="!size-4" />
          </Button>
        )}
      </div>

      {/* Remi's pick number, in a black strip across the top (matching his selected pin) */}
      {pickNumber && (
        <div className="rounded-t-[11px] bg-foreground px-4 py-1 pr-10 text-caption font-semibold uppercase tracking-wider text-background">
          Remi&apos;s pick #{pickNumber}
        </div>
      )}

      {header}

      {/* Why Remi picked it and how far it is (his picks only), then the Reserve row, set a little
          further apart since it's a different kind of thing (acting on it, not reading about it) */}
      <CardContent className="flex flex-col gap-3 p-4 pt-0">
        {whyBlock}
        <TravelTimes reason={reason} />
        <div className={cn((whyBlock || (reason?.distances.length ?? 0) > 0) && "mt-2")}>{actions}</div>
      </CardContent>

      {/* 5. Reviews & more: a grey footer strip that opens downward into the accordions; once
          open, the strip's title gives way to the sections, with "Show less" at the bottom */}
      {hasDetails && (
        <div className="rounded-b-xl border-t bg-muted" onClick={(e) => e.stopPropagation()}>
          {showMore ? (
            <>
              <div className="max-h-[50vh] overflow-y-auto px-4 pt-1">{details}</div>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1 rounded-b-xl py-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)] hover:text-foreground"
                onClick={() => {
                  setShowMore(false);
                  setOpenSection("");
                }}
                aria-expanded
              >
                Show less
                <ChevronDown className="size-3.5 rotate-180" />
              </button>
            </>
          ) : (
            <button
              type="button"
              // Same small uppercase label as "Getting there", but dark (grey on the grey strip would
              // look disabled); the strip and chevron say it opens
              className={cn(
                "flex w-full items-center justify-between rounded-b-xl px-4 py-2.5 transition-colors",
                SECTION_LABEL,
                "text-foreground hover:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]"
              )}
              onClick={() => {
                setShowMore(true);
                onExpandDrawer?.();
              }}
              aria-expanded={false}
            >
              Reviews &amp; more
              <ChevronDown className="size-4 text-muted-foreground" />
            </button>
          )}
        </div>
      )}
    </Card>
    </TooltipProvider>
  );
}
