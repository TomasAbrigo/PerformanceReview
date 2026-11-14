"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** /team: links to each direct report's peer feedback (read via canRead). */
export function TeamPeerFeedback({
  rows,
}: {
  rows: {
    cycleId: string;
    cycleName: string;
    participantId: string;
    revieweeName: string;
  }[];
}) {
  const t = useTranslations("Peers");
  if (rows.length === 0) return null;
  return (
    <section
      aria-labelledby="team-peer-feedback"
      className="flex flex-col gap-2"
    >
      <h2 id="team-peer-feedback" className="text-lg font-medium">
        {t("teamFeedback")}
      </h2>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.participantId}>
            <Link
              href={`/cycles/${r.cycleId}/peers/feedback/${r.participantId}`}
              className="underline"
            >
              {t("teamFeedbackLink", {
                name: r.revieweeName,
                cycle: r.cycleName,
              })}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
