import type { Review } from "@/modules/review-core/answers";
import type { SelfReviewData } from "./self-review-form";

/** Maps a domain review to the props of SelfReviewForm and its wrappers. */
export function toReviewData(review: Review): SelfReviewData {
  return {
    requestId: review.request.id,
    cycleName: review.cycle.name,
    dueDate: review.cycle.dueDate,
    status: review.request.status,
    submittedAt: review.request.submittedAt,
    canWrite: review.canWrite,
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
