"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { CalibrationGroupKind } from "@/modules/review-core/calibration-constants";
import type { GroupItem } from "@/modules/review-core/calibration";

export type NewGroupInput = {
  name: string;
  kind: CalibrationGroupKind;
  criterion: string;
};

const fieldClass =
  "rounded-md border border-input bg-background px-2 py-1 text-sm";

/** Groups of a cycle and (HR) a form to create one. */
export function GroupsPanel({
  cycleId,
  groups,
  selectedId,
  canCreate,
  departments,
  managers,
  create,
}: {
  cycleId: string;
  groups: GroupItem[];
  selectedId: string | null;
  canCreate: boolean;
  departments: string[];
  managers: { id: string; name: string }[];
  create: (cycleId: string, input: NewGroupInput) => Promise<ActionResult>;
}) {
  const t = useTranslations("Calibration");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CalibrationGroupKind>("by_department");
  const [criterion, setCriterion] = useState(departments[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const choices =
    kind === "by_department"
      ? departments.map((d) => ({ id: d, name: d }))
      : kind === "by_manager"
        ? managers
        : [];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t("groups")}</h2>
      {groups.length === 0 ? (
        <p className="text-muted-foreground">{t("noGroups")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/cycles/${cycleId}/calibration?group=${g.id}`}
                aria-current={g.id === selectedId ? "page" : undefined}
                className="rounded-md border px-2 py-1 text-sm aria-[current=page]:bg-muted"
              >
                {g.name} ({g.members})
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canCreate ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await create(cycleId, { name, kind, criterion });
              if (result.ok) {
                setName("");
                setError(null);
              } else setError(t("errors.unknown"));
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t("groupName")}
            <input
              className={fieldClass}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("groupKind")}
            <select
              className={fieldClass}
              value={kind}
              onChange={(e) => {
                const k = e.target.value as CalibrationGroupKind;
                setKind(k);
                setCriterion(
                  k === "by_department"
                    ? (departments[0] ?? "")
                    : k === "by_manager"
                      ? (managers[0]?.id ?? "")
                      : "",
                );
              }}
            >
              {(["by_department", "by_manager", "manual"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
          {choices.length ? (
            <label className="flex flex-col gap-1 text-sm">
              {t("criterion")}
              <select
                className={fieldClass}
                value={criterion}
                onChange={(e) => setCriterion(e.target.value)}
              >
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="submit" disabled={pending}>
            {t("createGroup")}
          </Button>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
