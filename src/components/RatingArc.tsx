import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Yelp rating as five stars on an arc (like the star arc above a selected pin on the map),
 * the exact value under the arc, and the review count below. Stars are filled to the rating
 * (4.1 → four full, one 10%) and pop in one after another.
 *
 * size "md" stands alone; "sm" is sized to sit beside a card's name + tags (~60px tall).
 */

const SIZES = {
  md: { star: 18, radius: 40, value: "text-heading" },
  sm: { star: 15, radius: 31, value: "text-[18px]" },
} as const;
const ANGLES = [-56, -28, 0, 28, 56]; // degrees from vertical, left → right

export default function RatingArc({
  rating,
  reviews,
  size = "md",
}: {
  rating: number;
  reviews: string;
  size?: keyof typeof SIZES;
}) {
  const { star, radius, value } = SIZES[size];
  const width = 2 * radius * Math.sin((56 * Math.PI) / 180) + star + 4;
  const drop = radius * (1 - Math.cos((56 * Math.PI) / 180)); // how far the outer stars sit below the middle one

  return (
    <div className="flex w-fit shrink-0 flex-col items-center" aria-label={`Rated ${rating.toFixed(1)} out of 5 on Yelp`}>
      <div className="relative" style={{ width, height: drop + star + 2 }}>
        {ANGLES.map((deg, i) => {
          const rad = (deg * Math.PI) / 180;
          const fill = Math.min(Math.max(rating - i, 0), 1);
          return (
            <span
              key={deg}
              aria-hidden="true"
              className="absolute duration-300 animate-in fade-in-0 zoom-in-50 fill-mode-both motion-reduce:animate-none"
              style={{
                left: width / 2 + radius * Math.sin(rad) - star / 2,
                top: radius * (1 - Math.cos(rad)),
                width: star,
                height: star,
                transform: `rotate(${deg}deg)`,
                animationDelay: `${i * 70}ms`,
              }}
            >
              <Star className="absolute inset-0 size-full fill-grey-lightest text-grey-light" strokeWidth={1.5} />
              {fill > 0 && (
                <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
                  <Star className="fill-amber text-amber" style={{ width: star, height: star }} strokeWidth={1.5} />
                </span>
              )}
            </span>
          );
        })}
      </div>
      <span
        className={cn(
          value,
          "-mt-1 font-bold leading-none duration-300 animate-in fade-in-0 fill-mode-both [animation-delay:350ms] motion-reduce:animate-none"
        )}
      >
        {rating.toFixed(1)}
      </span>
      <span className="mt-0.5 text-caption leading-tight text-muted-foreground">{reviews}</span>
    </div>
  );
}
