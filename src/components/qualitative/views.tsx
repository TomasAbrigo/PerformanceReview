import type { MarkDrill } from "@/components/charts";
import type { DrillBase } from "@/components/drill/drill-link";
import type { CommentScope } from "@/modules/insights/drill-spec";

/**
 * Where the comments behind a mark open: the page (`base`) and the scope of
 * its filters (`scope`); each mark adds what it stands for. The panels of
 * the open-text reading (#129) live in `reading.tsx`.
 */
export type CommentDrills = { base: DrillBase; scope: CommentScope };

/** The drill of the comments of `ctx`'s scope narrowed by `extra`. */
export function commentDrill(
  ctx: CommentDrills,
  extra: CommentScope,
): MarkDrill {
  return {
    base: ctx.base,
    drill: { kind: "comments", scope: { ...ctx.scope, ...extra } },
  };
}
