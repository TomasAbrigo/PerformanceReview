import type { Review } from "@/modules/review-core/answers";
import type { ReviewData } from "./read-only-answers";

/** Maps a domain review to the props of the read-only answer views. */
export function toReviewData(review: Review): ReviewData {
  return {
    requestId: review.request.id,
    cycleName: review.cycle.name,
    dueDate: review.cycle.dueDate,
    status: review.request.status,
    submittedAt: review.request.submittedAt,
    questions: review.questions.map((q) => ({
      id: q.id,
      sectionTitle: q.sectionTitle,
      prompt: q.prompt,
      kind: q.kind,
      required: q.required,
      scale: q.scale,
      choices: q.choices,
      visibleToReviewee: q.visibleToReviewee,
    })),
    answers: review.answers,
  };
}
