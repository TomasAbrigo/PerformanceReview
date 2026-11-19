import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, db } from "@/db/client";
import { parseYesNo, yesNoDetailSql, yesNoTokenSql } from "./analysis-text";
import { YES_NO_CASES } from "./yes-no-cases";

afterAll(closeDb);

describe("parseYesNo and its SQL twin", () => {
  it("agree on every spelling", async () => {
    const texts = YES_NO_CASES.map(([t]) => t);
    const rows = await db.execute<{
      t: string;
      answer: string | null;
      detail: string | null;
    }>(sql`
      select t, ${yesNoTokenSql(sql`t`)} as answer, ${yesNoDetailSql(sql`t`)} as detail
      from unnest(array[${sql.join(
        texts.map((t) => sql`${t}`),
        sql`, `,
      )}]::text[]) as t`);
    expect(rows).toHaveLength(texts.length);
    for (const r of rows) {
      expect({ text: r.t, answer: r.answer, detail: r.detail }).toEqual({
        text: r.t,
        ...parseYesNo(r.t),
      });
    }
  });
});
