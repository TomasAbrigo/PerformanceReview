import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  type LocalizedText,
  question,
  ratingScale,
  reviewTemplate,
  type QuestionRole,
  type Relationship,
  templateSection,
} from "@/db/schema";
import { createScale, createTemplate } from "./service";
import type { ScaleInput } from "./validation";

/** Stable keys of the system scales. */
export const SYSTEM_SCALES = {
  fourPoint: "four_point_descriptive",
  fivePoint: "five_point_agreement",
  frequency: "never_always",
} as const;
type ScaleKey = (typeof SYSTEM_SCALES)[keyof typeof SYSTEM_SCALES];

const scales: Record<ScaleKey, ScaleInput> = {
  four_point_descriptive: {
    name: { es: "4 puntos descriptiva", en: "4-point descriptive" },
    options: [
      {
        value: 1,
        label: { es: "Necesita desarrollo", en: "Needs development" },
      },
      {
        value: 2,
        label: { es: "Cumple expectativas", en: "Meets expectations" },
      },
      { value: 3, label: { es: "Supera a menudo", en: "Often exceeds" } },
      {
        value: 4,
        label: { es: "Marca un nuevo estándar", en: "Sets a new standard" },
      },
    ],
  },
  five_point_agreement: {
    name: { es: "5 puntos", en: "5-point agreement" },
    options: [
      {
        value: 1,
        label: { es: "Totalmente en desacuerdo", en: "Strongly disagree" },
      },
      { value: 2, label: { es: "En desacuerdo", en: "Disagree" } },
      { value: 3, label: { es: "Neutral", en: "Neutral" } },
      { value: 4, label: { es: "De acuerdo", en: "Agree" } },
      {
        value: 5,
        label: { es: "Totalmente de acuerdo", en: "Strongly agree" },
      },
    ],
  },
  never_always: {
    name: { es: "Nunca…Siempre", en: "Never…Always" },
    options: [
      { value: 1, label: { es: "Nunca", en: "Never" } },
      { value: 2, label: { es: "Rara vez", en: "Rarely" } },
      { value: 3, label: { es: "A veces", en: "Sometimes" } },
      { value: 4, label: { es: "A menudo", en: "Often" } },
      { value: 5, label: { es: "Siempre", en: "Always" } },
    ],
  },
};

type SeedQuestion = {
  prompt: LocalizedText;
  appliesTo: Relationship[];
  kind?: "text" | "rating";
  scale?: ScaleKey;
  required?: boolean;
  visibleToReviewee?: boolean;
  role?: QuestionRole;
};
type SeedTemplate = {
  key: string;
  name: LocalizedText;
  description: LocalizedText;
  enabled?: boolean;
  sections: { title: LocalizedText; questions: SeedQuestion[] }[];
};

const self = (es: string, en: string): SeedQuestion => ({
  prompt: { es, en },
  appliesTo: ["self"],
  required: true,
});
const manager = (
  es: string,
  en: string,
  scale?: ScaleKey,
  role?: QuestionRole,
): SeedQuestion => ({
  prompt: { es, en },
  appliesTo: ["manager"],
  kind: scale ? "rating" : "text",
  scale,
  required: true,
  role,
});
const peer = (es: string, en: string): SeedQuestion => ({
  prompt: { es, en },
  appliesTo: ["peer"],
  required: true,
});

const peerQuestions: SeedQuestion[] = [
  peer(
    "¿Cuáles son las mayores fortalezas de esta persona?",
    "What are this person's biggest strengths?",
  ),
  peer(
    "Describe un logro de esta persona que hayas observado.",
    "Describe one success you observed from this person.",
  ),
  peer(
    "¿En qué áreas podría mejorar?",
    "What are areas where this person could improve?",
  ),
];

const templates: SeedTemplate[] = [
  {
    key: "year_end",
    name: { es: "Evaluación de fin de año", en: "Year-end review" },
    description: {
      es: "Autoevaluación, evaluación del manager y feedback de pares.",
      en: "Self-reflection, manager review and peer feedback.",
    },
    sections: [
      {
        title: { es: "Autoevaluación", en: "Self-reflection" },
        questions: [
          self(
            "¿Qué avances lograste en tus objetivos y qué impacto tuvieron?",
            "What progress have you made on your goals, and what impact did it have?",
          ),
          self(
            "¿Qué obstáculos te impidieron avanzar?",
            "What blockers got in the way of your progress?",
          ),
          self(
            "¿Cómo te desarrollaste durante este período?",
            "How have you developed during this period?",
          ),
          self(
            "¿Qué 2 o 3 habilidades te gustaría desarrollar en el próximo período?",
            "What 2-3 skills would you like to develop next period?",
          ),
        ],
      },
      {
        title: { es: "Evaluación del manager", en: "Manager review" },
        questions: [
          manager(
            "¿Cómo calificarías el avance en sus objetivos?",
            "How would you rate their progress on goals?",
            "four_point_descriptive",
            "goals_rating",
          ),
          manager(
            "Comenta el avance en sus objetivos.",
            "Comment on their progress on goals.",
            undefined,
            "goals_comment",
          ),
          manager(
            "¿Cuáles fueron hasta tres de sus mayores logros?",
            "What were up to three of their biggest wins?",
          ),
          manager(
            "¿Cuáles son sus oportunidades de crecimiento y los próximos pasos?",
            "What are their growth opportunities and next steps?",
          ),
          manager(
            "¿En qué debería enfocarse en el próximo período?",
            "What should they focus on next period?",
          ),
          manager(
            "Calificación general de desempeño",
            "Overall performance rating",
            "four_point_descriptive",
            "overall_rating",
          ),
        ],
      },
      {
        title: { es: "Feedback de pares", en: "Peer feedback" },
        questions: peerQuestions,
      },
    ],
  },
  {
    key: "mid_year_development",
    name: {
      es: "Ciclo de desarrollo de mitad de año",
      en: "Mid-year development cycle",
    },
    description: {
      es: "Conversación de desarrollo sin calificaciones.",
      en: "Development conversation without ratings.",
    },
    sections: [
      {
        title: { es: "Autoevaluación", en: "Self-reflection" },
        questions: [
          self(
            "¿Qué avances lograste en tus objetivos hasta ahora?",
            "What progress have you made on your goals so far?",
          ),
          self(
            "¿Qué obstáculos te impidieron avanzar?",
            "What blockers got in the way of your progress?",
          ),
          self(
            "¿Qué 2 o 3 habilidades te gustaría desarrollar en lo que resta del año?",
            "What 2-3 skills would you like to develop for the rest of the year?",
          ),
        ],
      },
      {
        title: { es: "Manager", en: "Manager" },
        questions: [
          manager(
            "¿Cuáles fueron sus mayores logros hasta ahora?",
            "What have been their biggest wins so far?",
          ),
          manager(
            "¿Cuáles son sus oportunidades de crecimiento y los próximos pasos?",
            "What are their growth opportunities and next steps?",
          ),
          manager(
            "¿En qué debería enfocarse en el resto del año?",
            "What should they focus on for the rest of the year?",
          ),
        ],
      },
    ],
  },
  {
    key: "peer_feedback",
    name: { es: "Feedback de pares", en: "Peer feedback" },
    description: {
      es: "Feedback de pares sobre fortalezas, logros y áreas de mejora.",
      en: "Peer feedback on strengths, successes and areas to improve.",
    },
    sections: [
      {
        title: { es: "Feedback de pares", en: "Peer feedback" },
        questions: [
          ...peerQuestions,
          {
            prompt: {
              es: "¿Hay algo que quieras compartir solo con su manager?",
              en: "Is there anything you'd like to share only with their manager?",
            },
            appliesTo: ["peer"],
            required: false,
            visibleToReviewee: false,
          },
        ],
      },
    ],
  },
  {
    key: "upward",
    name: { es: "Upward", en: "Upward" },
    description: {
      es: "Feedback del equipo sobre su manager (desactivado en v1).",
      en: "Team feedback about their manager (off in v1).",
    },
    enabled: false,
    sections: [
      {
        title: { es: "Efectividad del manager", en: "Manager effectiveness" },
        questions: [
          ...(
            [
              [
                "Me da feedback que me ayuda a mejorar.",
                "My manager gives me feedback that helps me improve.",
              ],
              [
                "Me ayuda a priorizar y tener claridad sobre lo que se espera de mí.",
                "My manager helps me prioritize and be clear on what is expected of me.",
              ],
              [
                "Apoya mi crecimiento profesional.",
                "My manager supports my career growth.",
              ],
              [
                "Reconoce mi trabajo cuando hago un buen trabajo.",
                "My manager recognizes me when I do good work.",
              ],
            ] as const
          ).map(([es, en]): SeedQuestion => ({
            prompt: { es, en },
            appliesTo: ["upward"],
            kind: "rating",
            scale: "never_always",
            required: true,
          })),
          {
            prompt: {
              es: "¿Cuáles son las mayores fortalezas de tu manager?",
              en: "What are your manager's top strengths?",
            },
            appliesTo: ["upward"],
            required: true,
          },
        ],
      },
    ],
  },
];

/** Inserts the system scales and templates that are missing. Safe to run repeatedly. */
export async function seedSystemTemplates(db: DbOrTx): Promise<void> {
  const scaleIds = {} as Record<ScaleKey, string>;
  for (const [key, input] of Object.entries(scales) as [
    ScaleKey,
    ScaleInput,
  ][]) {
    const [existing] = await db
      .select({ id: ratingScale.id })
      .from(ratingScale)
      .where(eq(ratingScale.systemKey, key));
    scaleIds[key] =
      existing?.id ??
      (await createScale(db, input, { isSystem: true, systemKey: key })).id;
  }

  for (const seed of templates) {
    const [existing] = await db
      .select({ id: reviewTemplate.id })
      .from(reviewTemplate)
      .where(eq(reviewTemplate.systemKey, seed.key));
    if (existing) continue;
    await db.transaction(async (tx) => {
      const template = await createTemplate(
        tx,
        { name: seed.name, description: seed.description },
        { isSystem: true, systemKey: seed.key, enabled: seed.enabled ?? true },
      );
      for (const [sort, section] of seed.sections.entries()) {
        const [row] = await tx
          .insert(templateSection)
          .values({ templateId: template.id, sort, title: section.title })
          .returning();
        await tx.insert(question).values(
          section.questions.map((q, i) => ({
            sectionId: row.id,
            sort: i,
            kind: q.kind ?? "text",
            appliesTo: q.appliesTo,
            required: q.required ?? false,
            visibleToReviewee: q.visibleToReviewee ?? true,
            scaleId: q.scale ? scaleIds[q.scale] : null,
            prompt: q.prompt,
            role: q.role ?? null,
          })),
        );
      }
    });
  }
}
