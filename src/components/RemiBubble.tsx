import type { ReactNode } from "react";
import { asset } from "../utils/asset";
import { cn } from "@/lib/utils";
import { Bubble, BubbleContent } from "@/components/ui/bubble";

const REMI_BUBBLE_CONTENT =
  "flex w-full gap-3 rounded-2xl rounded-tl-sm px-3 py-2.5 font-sans text-body text-foreground shadow-xs whitespace-pre-wrap";

/**
 * Remi's white message tile (shadcn Bubble), with his avatar inside it at the top-left and the
 * content beside: his chat replies, and the mobile walkthrough's lines.
 */
export default function RemiBubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Bubble variant="outline" className="w-full max-w-full">
      <BubbleContent className={cn(REMI_BUBBLE_CONTENT, className)}>
        <img src={asset("/remi.png")} alt="Remi" className="size-10 shrink-0 rounded-full object-cover md:size-12" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
      </BubbleContent>
    </Bubble>
  );
}
