import type { Locator, Page } from "@playwright/test";

/**
 * Helpers for the card lists of the approved canvas: a `CardCollection` is a
 * labelled group of `article`s that keeps the records past the first few
 * behind a "show N more" disclosure; counts are `MetricCard`s, each a region
 * named by its label.
 */

/** Opens every "show more records" disclosure inside `scope`, so every card is visible. */
export async function showAllCards(scope: Locator) {
  const closed = scope.locator("details.collection-more:not([open]) > summary");
  while ((await closed.count()) > 0) await closed.first().click();
}

/** The value (`dd`) of the fact labelled `label` (`dt`) inside a card. */
export const fact = (card: Locator, label: string) =>
  card
    .locator("dl > div")
    .filter({ has: card.page().getByText(label, { exact: true }) })
    .locator("dd");

/** The value of the count card labelled `label` inside a counts group. */
export const countValue = (counts: Locator, label: string) =>
  counts
    .getByRole("region", { name: label, exact: true })
    .locator(".stat-value");

/**
 * The identity-queue card of a record: the one headed by the person's name
 * that carries the source id (as "…: <id>" in the open queue, or as the bare
 * value of a fact in the history).
 */
export const queueCard = (
  page: Page,
  name: string,
  sourceId: string | number,
) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .filter({ has: page.getByText(new RegExp(`^(.*: )?${sourceId}$`)) });
