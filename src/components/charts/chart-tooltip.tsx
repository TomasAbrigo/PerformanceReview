"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tooltip layer of a chart: any descendant with `data-tip` shows its text on
 * hover and on keyboard focus (marks carry tabIndex=0), positioned above the
 * mark. Server-rendered SVG stays static; this is the only client piece.
 */
export function ChartTooltip({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]");
      if (!el || !root.contains(el)) return;
      const box = el.getBoundingClientRect();
      const host = root.getBoundingClientRect();
      setTip({
        text: el.getAttribute("data-tip") ?? "",
        x: box.left + box.width / 2 - host.left,
        y: box.top - host.top,
      });
    };
    const hide = () => setTip(null);
    root.addEventListener("mouseover", show);
    root.addEventListener("focusin", show);
    root.addEventListener("mouseleave", hide);
    root.addEventListener("focusout", hide);
    return () => {
      root.removeEventListener("mouseover", show);
      root.removeEventListener("focusin", show);
      root.removeEventListener("mouseleave", hide);
      root.removeEventListener("focusout", hide);
    };
  }, []);
  return (
    <div ref={ref} className="relative">
      {children}
      {tip ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-xs -translate-x-1/2 -translate-y-full rounded-md border border-border bg-popover px-2 py-1 text-xs whitespace-pre-line text-popover-foreground shadow-md"
          style={{ left: tip.x, top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}
