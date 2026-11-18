import postgres from "postgres";
import { assertLocalDatabase } from "../src/db/local";
import { e2eDatabaseUrl } from "./database";

/** What the org attributes specs need to know of what the import left (read only). */
async function query<T extends object>(
  run: (sql: postgres.Sql) => Promise<T[]>,
): Promise<T[]> {
  const url = e2eDatabaseUrl();
  assertLocalDatabase(url);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

/** The DM attribute of a participant on the snapshot date of their cycle. */
const DM_ON_SNAPSHOT = `
  join person_org_attribute oa
    on oa.person_id = cp.reviewee_person_id and oa.kind = 'dm'
   and oa.deleted_at is null and oa.valid_from <= cp.snapshot_as_of
   and (oa.valid_to is null or oa.valid_to >= cp.snapshot_as_of)`;

/** People per DM in a cycle (those whose DM attribute names them), by DM name. */
export async function peoplePerDm(
  cycleName: string,
): Promise<Map<string, number>> {
  const rows = await query<{ dm: string; people: number }>(
    (sql) =>
      sql.unsafe(
        `select oa.value as dm, count(*)::int as people
         from cycle_participant cp
         join review_cycle c on c.id = cp.cycle_id and c.name = $1
         ${DM_ON_SNAPSHOT}
         where cp.removed_at is null
         group by 1`,
        [cycleName],
      ) as unknown as Promise<{ dm: string; people: number }[]>,
  );
  return new Map(rows.map((r) => [r.dm, r.people]));
}

/**
 * A DM who is a person with a name nobody else has (the actor selector picks
 * people by name) and who has, in the cycle, direct reports of the snapshot
 * that the file puts under them: what a manager acting as them sees.
 */
export async function dmWithReports(
  cycleName: string,
): Promise<{ id: string; name: string; people: number }> {
  const [row] = await query<{ id: string; name: string; people: number }>(
    (sql) =>
      sql.unsafe(
        `select p.id, p.display_name as name, count(*)::int as people
         from cycle_participant cp
         join review_cycle c on c.id = cp.cycle_id and c.name = $1
         ${DM_ON_SNAPSHOT}
         join person p on p.id = cp.snap_manager_person_id
                      and p.display_name = oa.value
         where cp.removed_at is null
           and (select count(*) from person q where q.display_name = p.display_name) = 1
         group by p.id, p.display_name
         order by 3 desc, 2
         limit 1`,
        [cycleName],
      ) as unknown as Promise<{ id: string; name: string; people: number }[]>,
  );
  if (!row) throw new Error(`no DM has direct reports in ${cycleName}`);
  return row;
}

/** A manager of the cycle (snapshot) who is no DM of the file, with a unique name. */
export async function managerWhoIsNoDm(
  cycleName: string,
): Promise<{ id: string; name: string }> {
  const [row] = await query<{ id: string; name: string }>(
    (sql) =>
      sql.unsafe(
        `select distinct p.id, p.display_name as name
         from cycle_participant cp
         join review_cycle c on c.id = cp.cycle_id and c.name = $1
         join person p on p.id = cp.snap_manager_person_id
         where cp.removed_at is null
           and (select count(*) from person q where q.display_name = p.display_name) = 1
           and not exists (select 1 from person_org_attribute a
                           where a.kind = 'dm' and a.value = p.display_name)
         order by 2
         limit 1`,
        [cycleName],
      ) as unknown as Promise<{ id: string; name: string }[]>,
  );
  if (!row) throw new Error(`every manager of ${cycleName} is a DM`);
  return row;
}

/** The person called `name` (the specs pick people with a name nobody else has). */
export async function personIdOf(name: string): Promise<string> {
  const [row] = await query<{ id: string }>(
    (sql) =>
      sql.unsafe(`select id from person where display_name = $1`, [
        name,
      ]) as unknown as Promise<{ id: string }[]>,
  );
  if (!row) throw new Error(`no person called ${name}`);
  return row.id;
}
