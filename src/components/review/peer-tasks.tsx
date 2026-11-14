"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { FeedbackTask, NominationTask } from "@/modules/review-core/peers";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-lg font-medium">
        {title}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function Row({
  label,
  href,
  cta,
}: {
  label: string;
  href: string;
  cta: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-4">
      <span className="font-medium">{label}</span>
      <Link href={href} className={buttonVariants({ size: "sm" })}>
        {cta}
      </Link>
    </li>
  );
}

/** /me: peers to nominate, feedback to give and shared peer feedback. */
export function PeerTasks({
  nominations,
  feedback,
  sharedCycles = [],
}: {
  nominations: NominationTask[];
  feedback: FeedbackTask[];
  /** Cycles whose review was shared with the actor (peer feedback link). */
  sharedCycles?: { cycleId: string; cycleName: string }[];
}) {
  const t = useTranslations("Peers");
  return (
    <div className="flex flex-col gap-6">
      {nominations.length ? (
        <Section id="peer-nominations" title={t("myNominations")}>
          {nominations.map((n) => (
            <Row
              key={n.participantId}
              label={t("nominationTask", {
                cycle: n.cycleName,
                count: n.nominated,
                max: n.max,
              })}
              href={`/cycles/${n.cycleId}/peers`}
              cta={t("open")}
            />
          ))}
        </Section>
      ) : null}
      {feedback.length ? (
        <Section id="peer-feedback" title={t("myFeedback")}>
          {feedback.map((f) => (
            <Row
              key={f.requestId}
              label={t("feedbackTask", {
                name: f.revieweeName,
                cycle: f.cycleName,
              })}
              href={`/cycles/${f.cycleId}/peers/${f.requestId}`}
              cta={t("open")}
            />
          ))}
        </Section>
      ) : null}
      {sharedCycles.length ? (
        <Section id="peer-shared" title={t("feedbackTitle")}>
          {sharedCycles.map((c) => (
            <Row
              key={c.cycleId}
              label={t("viewMyFeedback", { cycle: c.cycleName })}
              href={`/cycles/${c.cycleId}/peers/feedback/me`}
              cta={t("open")}
            />
          ))}
        </Section>
      ) : null}
    </div>
  );
}
