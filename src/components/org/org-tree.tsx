"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Link } from "@/i18n/navigation";
import type { OrgNode } from "@/modules/org-history/queries";

type Children = Map<string | null, OrgNode[]>;

function TreeNode({ node, kids }: { node: OrgNode; kids: Children }) {
  const t = useTranslations("Org");
  const [open, setOpen] = useState(true);
  const children = kids.get(node.personId) ?? [];
  const subtitle = [node.jobTitle, node.department].filter(Boolean).join(" · ");

  return (
    <li role="treeitem" aria-label={node.displayName} aria-selected={false}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center gap-1 py-1">
          {children.length > 0 ? (
            <CollapsibleTrigger
              aria-label={t(open ? "collapse" : "expand", {
                name: node.displayName,
              })}
              className="rounded p-0.5 hover:bg-muted"
            >
              {open ? (
                <ChevronDown className="size-4" aria-hidden />
              ) : (
                <ChevronRight className="size-4" aria-hidden />
              )}
            </CollapsibleTrigger>
          ) : (
            <span className="inline-block w-5" aria-hidden />
          )}
          <Link href={`/people/${node.personId}`} className="hover:underline">
            {node.displayName}
          </Link>
          {subtitle && (
            <span className="text-sm text-muted-foreground">{subtitle}</span>
          )}
        </div>
        {children.length > 0 && (
          <CollapsibleContent>
            <ul role="group" className="ml-4 border-l pl-2">
              {children.map((c) => (
                <TreeNode key={c.personId} node={c} kids={kids} />
              ))}
            </ul>
          </CollapsibleContent>
        )}
      </Collapsible>
    </li>
  );
}

/** Org chart from orgTreeAsOf's depth-first list; every subtree collapsible. */
export function OrgTree({ nodes }: { nodes: OrgNode[] }) {
  const t = useTranslations("Org");
  if (nodes.length === 0) return <p>{t("empty")}</p>;

  const kids: Children = new Map();
  for (const n of nodes) {
    const list = kids.get(n.parentId) ?? [];
    list.push(n);
    kids.set(n.parentId, list);
  }
  return (
    <ul role="tree" aria-label={t("treeLabel")}>
      {(kids.get(null) ?? []).map((n) => (
        <TreeNode key={n.personId} node={n} kids={kids} />
      ))}
    </ul>
  );
}
