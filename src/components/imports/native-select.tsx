import type { ComponentProps } from "react";
import { cn } from "cn";

/**
 * A plain `<select>` styled like `Input`: short fixed lists in forms where the
 * popup of the Base UI select adds nothing (and is harder to drive from tests).
 */
export function NativeSelect({
  className,
  ...props
}: ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
        className,
      )}
      {...props}
    />
  );
}
