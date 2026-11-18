import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import {
  type Choice,
  type LocalizedText,
  question,
  ratingScale,
  reviewTemplate,
  type QuestionDimension,
  type QuestionRole,
  type Relationship,
  templateSection,
} from "@/db/schema";
import { LIKERT_OPTIONS, type LikertRole } from "@/modules/likert";
import { createScale, createTemplate } from "./service";
import type { ScaleInput } from "./validation";

/** Stable keys of the system scales. */
export const SYSTEM_SCALES = {
  fourPoint: "four_point_descriptive",
  fivePoint: "five_point_agreement",
  frequency: "never_always",
  retention: "retention_1_5",
  engagement: "engagement_1_5",
  valued: "valued_1_4",
} as const;
type ScaleKey = (typeof SYSTEM_SCALES)[keyof typeof SYSTEM_SCALES];

/** A 1-n scale from the likert module's labels (index 0 there = the best). */
function likertScale(role: LikertRole, name: LocalizedText): ScaleInput {
  return {
    name,
    options: [...LIKERT_OPTIONS[role]].reverse().map((o, i) => ({
      value: i + 1,
      label: { es: o.scale.es, en: o.scale.en },
    })),
  };
}

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
  // Bamboo's manager Q1 and Q2 (research/07), worst to best.
  retention_1_5: likertScale("retention", {
    es: "Retención 1-5",
    en: "Retention 1-5",
  }),
  engagement_1_5: likertScale("engagement", {
    es: "Compromiso 1-5",
    en: "Engagement 1-5",
  }),
  // Bamboo's self Q1, "How well does [Company] recognize my value?", 1-4.
  valued_1_4: likertScale("valued", {
    es: "Valoración 1-4",
    en: "Valued 1-4",
  }),
};

type SeedQuestion = {
  prompt: LocalizedText;
  appliesTo: Relationship[];
  kind?: "text" | "rating" | "single_choice";
  scale?: ScaleKey;
  choices?: Choice[];
  required?: boolean;
  visibleToReviewee?: boolean;
  role?: QuestionRole;
  dimension?: QuestionDimension;
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

const open = (
  appliesTo: Relationship[],
  dimension: QuestionDimension,
  es: string,
  en: string,
): SeedQuestion => ({
  prompt: { es, en },
  appliesTo,
  required: true,
  dimension,
});
const likert = (
  role: LikertRole,
  scale: ScaleKey,
  es: string,
  en: string,
): SeedQuestion => ({
  prompt: { es, en },
  appliesTo: ["manager"],
  kind: "rating",
  scale,
  required: true,
  visibleToReviewee: false,
  role,
});
const yesNo: Choice[] = [
  { value: "yes", label: { es: "Sí", en: "Yes" } },
  { value: "no", label: { es: "No", en: "No" } },
];

/** A closed yes/no question (no dimension: never a comment to analyse). */
const yesNoQuestion = (
  appliesTo: Relationship[],
  es: string,
  en: string,
): SeedQuestion => ({
  prompt: { es, en },
  appliesTo,
  kind: "single_choice",
  choices: yesNo,
  required: true,
});

/**
 * Santex's semi-annual review exactly as it runs in Bamboo today (the real
 * question set, issue #123; nothing more, nothing less until People changes
 * it): the employee's valued (1-4), best work (one option), strengths,
 * improvement and three custom questions (social impact, environmental
 * impact, information security); the manager's strengths, improvement, one
 * custom question (frequent conversations) and the two closed Likert 1-5
 * questions (retention, engagement), hidden from the reviewee.
 */
const santex: SeedTemplate = {
  key: "santex_semester",
  name: { es: "Evaluación semestral Santex", en: "Santex semi-annual review" },
  description: {
    es: "Las preguntas de Bamboo tal como se usan hoy: valoración, qué ayudaría, fortalezas, mejora y tres custom del empleado; fortalezas, mejora, una custom y retención y compromiso del manager (Likert 1-5, ocultas para la persona evaluada).",
    en: "Bamboo's questions as used today: valued, what would help, strengths, improvement and three custom ones for the employee; strengths, improvement, one custom and the manager's retention and engagement (Likert 1-5, hidden from the reviewee).",
  },
  sections: [
    {
      title: { es: "Autoevaluación", en: "Self assessment" },
      questions: [
        {
          prompt: {
            es: "¿Qué tan bien reconoce Santex mi valor?",
            en: "How well does Santex recognize my value?",
          },
          appliesTo: ["self"],
          kind: "rating",
          scale: "valued_1_4",
          required: true,
          role: "valued",
          dimension: "valued",
        },
        {
          prompt: {
            es: "¿Qué tendría el mayor impacto en mi capacidad de hacer mi mejor trabajo más seguido?",
            en: "What would have the greatest impact on my ability to do my best work more often?",
          },
          appliesTo: ["self"],
          kind: "single_choice",
          choices: [
            {
              value: "nothing_i_have_all_i_need",
              label: {
                es: "Nada, tengo todo lo que necesito.",
                en: "Nothing, I have all I need.",
              },
            },
            {
              value: "company_direction_better_defined",
              label: {
                es: "Que la dirección o el propósito de la empresa estén mejor definidos.",
                en: "The company direction or purpose was better defined.",
              },
            },
            {
              value: "coworkers_more_committed",
              label: {
                es: "Compañeros más comprometidos con hacer un gran trabajo.",
                en: "Coworkers were more committed to doing great work.",
              },
            },
            {
              value: "work_fits_my_strengths",
              label: {
                es: "Un trabajo más acorde a mis fortalezas.",
                en: "Work that better fits my strengths.",
              },
            },
            { value: "other", label: { es: "Otro", en: "Other" } },
          ],
          required: true,
          dimension: "best_work",
        },
        open(
          ["self"],
          "strengths",
          "¿Qué cosas hago bien?",
          "What are some things I do well?",
        ),
        open(
          ["self"],
          "improvement",
          "¿Cómo podría mejorar?",
          "How could I improve?",
        ),
        open(
          ["self"],
          "custom_1",
          "¿Contribuyo con iniciativas de «Impacto social»? ¿Cómo?",
          'Do I contribute with initiatives related to "Social impact"? How?',
        ),
        open(
          ["self"],
          "custom_2",
          "¿Contribuyo con iniciativas de «Impacto ambiental»? ¿Cómo?",
          'Do I contribute with initiatives related to "Environmental impact"? How?',
        ),
        yesNoQuestion(
          ["self"],
          "¿Cumplo con todas las políticas y procedimientos de seguridad de la información de la compañía?",
          "Am I following all Information Security Policies and Procedures of the Company?",
        ),
      ],
    },
    {
      title: { es: "Evaluación del manager", en: "Manager assessment" },
      questions: [
        open(
          ["manager"],
          "strengths",
          "¿Qué cosas hace bien [Empleado]?",
          "What are some things [Employee] does well?",
        ),
        open(
          ["manager"],
          "improvement",
          "¿Cómo podría mejorar [Empleado]?",
          "How could [Employee] improve?",
        ),
        yesNoQuestion(
          ["manager"],
          "¿Hablo con esta persona con la frecuencia suficiente como para conocer sus necesidades y su situación actual?",
          "Do I speak with this employee frequently enough that I consider myself to be aware of his/her needs and current situation?",
        ),
        likert(
          "retention",
          "retention_1_5",
          "Retención: si [Empleado] recibiera una oferta de trabajo en otro lugar, yo…",
          "Retention: if [Employee] got a job offer elsewhere, I would…",
        ),
        likert(
          "engagement",
          "engagement_1_5",
          "Compromiso: ¿qué tan comprometido está [Empleado] con su trabajo?",
          "Engagement: how engaged is [Employee] at work?",
        ),
      ],
    },
  ],
};

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
  santex,
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
    if (existing && (await matchesSeed(db, existing.id, seed))) continue;
    await db.transaction(async (tx) => {
      // An outdated system template (its questions changed in a release)
      // is rewritten in place: cycles keep their frozen revisions.
      const template = existing
        ? await replaceHead(tx, existing.id, seed)
        : await createTemplate(
            tx,
            { name: seed.name, description: seed.description },
            {
              isSystem: true,
              systemKey: seed.key,
              enabled: seed.enabled ?? true,
            },
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
            choices: q.choices ?? null,
            role: q.role ?? null,
            dimension: q.dimension ?? null,
          })),
        );
      }
    });
  }
}

/** The questions a seed describes, in order, as one comparable string each. */
const seedShape = (seed: SeedTemplate): string[] =>
  seed.sections.flatMap((section) =>
    section.questions.map((q) =>
      [
        section.title.es,
        q.prompt.es,
        q.prompt.en,
        q.kind ?? "text",
        q.appliesTo.join("+"),
        q.role ?? "",
        q.dimension ?? "",
        q.scale ?? "",
        (q.choices ?? []).map((c) => c.value).join("/"),
      ].join("\t"),
    ),
  );

/** Whether the stored template still has the seed's questions. */
async function matchesSeed(
  db: DbOrTx,
  templateId: string,
  seed: SeedTemplate,
): Promise<boolean> {
  const rows = await db
    .select({
      section: templateSection.title,
      sectionSort: templateSection.sort,
      sort: question.sort,
      prompt: question.prompt,
      kind: question.kind,
      appliesTo: question.appliesTo,
      role: question.role,
      dimension: question.dimension,
      scaleId: question.scaleId,
      choices: question.choices,
    })
    .from(question)
    .innerJoin(templateSection, eq(question.sectionId, templateSection.id))
    .where(eq(templateSection.templateId, templateId))
    .orderBy(templateSection.sort, question.sort);
  const scaleKeys = new Map(
    (
      await db
        .select({ id: ratingScale.id, key: ratingScale.systemKey })
        .from(ratingScale)
    ).map((s) => [s.id, s.key ?? ""]),
  );
  const stored = rows.map((r) =>
    [
      r.section.es,
      r.prompt.es,
      r.prompt.en,
      r.kind,
      r.appliesTo.join("+"),
      r.role ?? "",
      r.dimension ?? "",
      r.scaleId ? (scaleKeys.get(r.scaleId) ?? "") : "",
      (r.choices ?? []).map((c) => c.value).join("/"),
    ].join("\t"),
  );
  const wanted = seedShape(seed);
  return (
    stored.length === wanted.length && stored.every((s, i) => s === wanted[i])
  );
}

/** Keeps the template row (cycles point at it), drops its sections and questions. */
async function replaceHead(
  tx: DbOrTx,
  templateId: string,
  seed: SeedTemplate,
): Promise<{ id: string }> {
  await tx
    .delete(templateSection)
    .where(eq(templateSection.templateId, templateId));
  await tx
    .update(reviewTemplate)
    .set({ name: seed.name, description: seed.description })
    .where(eq(reviewTemplate.id, templateId));
  return { id: templateId };
}
