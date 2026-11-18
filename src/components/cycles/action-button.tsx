"use client";

import { type ComponentProps } from "react";
import {
  type ActionResult,
  ErrorAlert,
  useAction,
} from "@/components/form-helpers";
import { Button } from "@/components/ui/button";

/**
 * A button that runs a server action (already bound to its arguments) and
 * shows the translated error below it when the action fails.
 */
export function ActionButton({
  action,
  children,
  variant = "outline",
  size,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
}) {
  const { pending, error, run } = useAction();
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() => run(action)}
      >
        {children}
      </Button>
      <ErrorAlert error={error} />
    </span>
  );
}
