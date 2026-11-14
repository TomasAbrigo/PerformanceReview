"use client";

import { useTranslations } from "next-intl";
import { Label } from "@/components/ui/label";
import {
  type PeerApproval,
  peerApprovals,
  type PeerSettings,
} from "@/modules/review-core/peer-settings";

/** Cycle wizard: peer nomination settings (locked after launch). */
export function PeerSettingsFields({
  id,
  value,
  onChange,
}: {
  id: string;
  value: PeerSettings;
  onChange: (value: PeerSettings) => void;
}) {
  const t = useTranslations("Peers");
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-max-nominations`}>{t("maxNominations")}</Label>
        <input
          id={`${id}-max-nominations`}
          type="number"
          min={1}
          max={10}
          className="h-9 w-24 rounded-md border bg-transparent px-2"
          value={value.maxNominations}
          onChange={(e) =>
            onChange({
              ...value,
              maxNominations: Math.min(
                10,
                Math.max(1, Number(e.target.value) || 1),
              ),
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${id}-approval`}>{t("approval")}</Label>
        <select
          id={`${id}-approval`}
          className="h-9 rounded-md border bg-transparent px-2"
          value={value.approval}
          onChange={(e) =>
            onChange({ ...value, approval: e.target.value as PeerApproval })
          }
        >
          {peerApprovals.map((a) => (
            <option key={a} value={a}>
              {t(`approvalModes.${a}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
