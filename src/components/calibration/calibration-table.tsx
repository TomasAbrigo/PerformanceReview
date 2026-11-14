"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  CalibrationTable,
  RatingCell,
} from "@/modules/review-core/calibration";

export type ProposeInput = {
  participantId: string;
  value: number;
  reason: string;
  flag: boolean;
};

const fieldClass =
  "rounded-md border border-input bg-background px-2 py-1 text-sm";

function Rating({ cell }: { cell: RatingCell | null }) {
  const locale = useLocale() as "es" | "en";
  const t = useTranslations("Calibration");
  if (!cell) return <span className="text-muted-foreground">{t("none")}</span>;
  return (
    <span>
      <span className="font-medium tabular-nums">{cell.value}</span>
      {cell.label ? ` · ${cell.label[locale]}` : null}
    </span>
  );
}

function ProposeForm({
  participantId,
  scale,
  current,
  propose,
}: {
  participantId: string;
  scale: CalibrationTable["scale"];
  current: number | null;
  propose: (input: ProposeInput) => Promise<ActionResult>;
}) {
  const t = useTranslations("Calibration");
  const locale = useLocale() as "es" | "en";
  const [value, setValue] = useState(String(current ?? scale[0]?.value ?? ""));
  const [reason, setReason] = useState("");
  const [flag, setFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `propose-${participantId}`;
  function save() {
    if (!reason.trim()) {
      setError(t("errors.reason_required"));
      return;
    }
    startTransition(async () => {
      const result = await propose({
        participantId,
        value: Number(value),
        reason,
        flag,
      });
      if (result.ok) {
        setReason("");
        setError(null);
      } else {
        setError(
          t.has(`errors.${result.code}` as "errors.unknown")
            ? t(`errors.${result.code}` as "errors.unknown")
            : t("errors.unknown"),
        );
      }
    });
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${id}-value`}>
          {t("proposed")}
        </label>
        <select
          id={`${id}-value`}
          className={fieldClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        >
          {scale.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value} · {o.label[locale]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={flag}
            onChange={(e) => setFlag(e.target.checked)}
          />
          {t("flag")}
        </label>
      </div>
      <label className="sr-only" htmlFor={`${id}-reason`}>
        {t("reason")}
      </label>
      <textarea
        id={`${id}-reason`}
        className={fieldClass}
        rows={2}
        required
        placeholder={t("reasonPlaceholder")}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={pending}
        onClick={save}
      >
        {t("propose")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A calibration group's table: employee, snapshot manager, the manager's
 * original rating next to the current one, and (HR only) an inline
 * proposal with a required reason. Calibrators get it read-only.
 */
export function CalibrationTableView({
  table,
  propose,
}: {
  table: CalibrationTable;
  propose: (input: ProposeInput) => Promise<ActionResult>;
}) {
  const t = useTranslations("Calibration");
  const locale = useLocale();
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{table.group.name}</h2>
        {!table.canEdit ? (
          <Badge variant="secondary">{t("readOnly")}</Badge>
        ) : null}
      </div>
      {table.rows.length === 0 ? (
        <p className="text-muted-foreground">{t("emptyGroup")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="p-2">{t("employee")}</th>
                <th className="p-2">{t("manager")}</th>
                <th className="p-2">{t("original")}</th>
                <th className="p-2">{t("current")}</th>
                <th className="p-2">{t("history")}</th>
                {table.canEdit ? (
                  <th className="p-2">{t("proposed")}</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.participantId} className="border-t align-top">
                  <td className="p-2">
                    {r.revieweeName}
                    {r.flagged ? (
                      <Badge variant="outline" className="ml-2">
                        {t("flagged")}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="p-2">{r.managerName ?? t("none")}</td>
                  <td className="p-2">
                    <Rating cell={r.managerRating} />
                  </td>
                  <td className="p-2">
                    <Rating cell={r.currentRating} />
                  </td>
                  <td className="p-2">
                    {r.history.length ? (
                      <ul className="flex flex-col gap-1">
                        {r.history.map((h, i) => (
                          <li key={i}>
                            <span className="tabular-nums">{h.value}</span>
                            {" — "}
                            {h.reason}
                            <span className="text-muted-foreground">
                              {" "}
                              (
                              {new Date(h.createdAt).toLocaleDateString(locale)}
                              )
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">{t("none")}</span>
                    )}
                  </td>
                  {table.canEdit ? (
                    <td className="p-2">
                      <ProposeForm
                        participantId={r.participantId}
                        scale={table.scale}
                        current={r.currentRating?.value ?? null}
                        propose={propose}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
