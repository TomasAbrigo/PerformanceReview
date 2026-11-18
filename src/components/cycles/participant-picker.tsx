"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { NativeSelect } from "@/components/imports/native-select";
import {
  type ActionResult,
  ErrorAlert,
  useAction,
} from "@/components/form-helpers";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import type { Candidate } from "@/modules/review-core";

export type SaveParticipants = (personIds: string[]) => Promise<ActionResult>;

/**
 * Chooses the participants of a draft cycle: every active person, an area at
 * a time or one by one. Saving stores them with their snapshot, so the
 * screen can list who has no manager before the cycle opens.
 */
export function ParticipantPicker({
  candidates,
  initial,
  save,
}: {
  candidates: Candidate[];
  initial: string[];
  save: SaveParticipants;
}) {
  const t = useTranslations("Cycles.participants");
  const id = useId();
  const [selected, setSelected] = useState(() => new Set(initial));
  const [area, setArea] = useState("");
  const [saved, setSaved] = useState(false);
  const { pending, error, run } = useAction();

  const areas = useMemo(
    () => [...new Set(candidates.map((c) => c.department ?? ""))].sort(),
    [candidates],
  );
  const change = (next: Set<string>) => {
    setSelected(next);
    setSaved(false);
  };
  const toggle = (personId: string) => {
    const next = new Set(selected);
    if (!next.delete(personId)) next.add(personId);
    change(next);
  };

  return (
    <form
      aria-label={t("title")}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => save([...selected]),
          () => setSaved(true),
        );
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => change(new Set(candidates.map((c) => c.personId)))}
        >
          {t("all")}
        </Button>
        <Field className="w-56">
          <FieldLabel htmlFor={`${id}-area`}>{t("area")}</FieldLabel>
          <NativeSelect
            id={`${id}-area`}
            value={area}
            onChange={(e) => setArea(e.target.value)}
          >
            <option value="" disabled>
              {t("areaPlaceholder")}
            </option>
            {areas.map((a) => (
              <option key={a} value={`area:${a}`}>
                {a || t("noArea")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button
          type="button"
          variant="outline"
          disabled={area === ""}
          onClick={() => {
            const wanted = area.slice("area:".length);
            const next = new Set(selected);
            for (const c of candidates) {
              if ((c.department ?? "") === wanted) next.add(c.personId);
            }
            change(next);
          }}
        >
          {t("addArea")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => change(new Set())}
          disabled={selected.size === 0}
        >
          {t("clear")}
        </Button>
      </div>
      <fieldset className="flex max-h-80 flex-col gap-1 overflow-y-auto rounded-lg border p-3">
        <legend className="px-1 text-sm text-muted-foreground">
          {t("searchLabel")}
        </legend>
        {candidates.map((c) => (
          <label key={c.personId} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.has(c.personId)}
              onChange={() => toggle(c.personId)}
            />
            <span>{c.displayName}</span>
            <span className="text-muted-foreground">
              {[c.department, c.managerName].filter(Boolean).join(" · ")}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
        <span className="text-sm text-muted-foreground" aria-live="polite">
          {saved ? t("saved") : t("selected", { count: selected.size })}
        </span>
      </div>
      <ErrorAlert error={error} />
    </form>
  );
}
