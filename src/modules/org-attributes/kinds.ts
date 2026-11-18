// Drizzle- and server-free: the kinds are shared by the schema, the import,
// the queries and the client components.

/** The organizational dimensions People keep per person and validity. */
export const orgAttributeKinds = [
  "account",
  "project",
  "dm",
  "santex_lead",
] as const;
export type OrgAttributeKind = (typeof orgAttributeKinds)[number];

/** What views group by when they cut by an organizational attribute. */
export const orgGroupBys = orgAttributeKinds;
export type OrgGroupBy = OrgAttributeKind;
export const isOrgGroupBy = (value: string): value is OrgGroupBy =>
  (orgGroupBys as readonly string[]).includes(value);

/**
 * The kinds that name a person (a team is its DM's): direction reads them
 * as teams (a key, never the name), as it does for managers.
 */
export const personKinds = [
  "dm",
  "santex_lead",
] as const satisfies readonly OrgAttributeKind[];
export const isPersonKind = (kind: string) =>
  (personKinds as readonly string[]).includes(kind);

/** The filters every view takes, one value per attribute (the text as imported). */
export type OrgFilters = {
  account?: string;
  project?: string;
  dm?: string;
  santexLead?: string;
};
export const orgFilterKeys = [
  "account",
  "project",
  "dm",
  "santexLead",
] as const;

/** The org attributes of a person as of a date, as the views carry them. */
export type OrgDims = {
  account: string | null;
  project: string | null;
  dm: string | null;
  santexLead: string | null;
};
export const noOrgDims: OrgDims = {
  account: null,
  project: null,
  dm: null,
  santexLead: null,
};

/** The value of a dimension for a `groupBy`. */
export function orgDimOf(dims: OrgDims, groupBy: OrgGroupBy): string | null {
  return groupBy === "santex_lead" ? dims.santexLead : dims[groupBy];
}

/**
 * Turns the value of a group that names a person (a DM, a Santex Lead) into
 * the opaque key direction reads instead of the name: a keyed hash with a
 * secret of the install (`groupKeyer`, server only: this module is shared with
 * the client, the secret never is).
 */
export type GroupKeyer = (value: string) => string;

/**
 * The key and label of a group of an org attribute. `masked` (direction): a
 * group that names a person has an opaque key (`keyOf`, required then: no
 * masking without a secret) and no label; the rest keep their value.
 */
export function groupIdentity(
  kind: OrgGroupBy,
  value: string | null,
  masked: boolean,
  keyOf?: GroupKeyer,
): { key: string | null; label: string | null } {
  if (value === null) return { key: null, label: null };
  if (masked && isPersonKind(kind)) {
    if (!keyOf) throw new Error(`Grouping by ${kind} needs a group keyer`);
    return { key: keyOf(value), label: null };
  }
  return { key: value, label: value };
}

/** Whether a grouping names people, so direction reads it through a keyer. */
export const needsKeyer = (kind: string) => isPersonKind(kind);

/**
 * The filters direction may use: not the ones that name a person (a DM, a
 * Santex Lead). Filtering by one would single out a team, and the selects do
 * not offer them; a URL or a call that carries them is read without them.
 * Anybody else keeps theirs. One place, asked by every view and every query.
 */
export function withoutPersonFilters<T extends OrgFilters>(
  filters: T,
  masked: boolean,
): T {
  return masked
    ? { ...filters, dm: undefined, santexLead: undefined }
    : filters;
}

export const hasOrgFilter = (f: OrgFilters) =>
  !!(f.account || f.project || f.dm || f.santexLead);

/** The values of the filter selects: what the people in view carry. */
export type OrgOptions = {
  accounts: string[];
  projects: string[];
  dms: string[];
  santexLeads: string[];
};
export const noOrgOptions: OrgOptions = {
  accounts: [],
  projects: [],
  dms: [],
  santexLeads: [],
};

const collator = new Intl.Collator("es");

/**
 * The values of the org selects over `rows`, sorted. `named` false (direction)
 * leaves out the DMs and Santex Leads: they are people, direction reads teams.
 */
export function orgOptionsOf(
  rows: readonly OrgDims[],
  named = true,
): OrgOptions {
  const uniq = (pick: (d: OrgDims) => string | null) =>
    [
      ...new Set(rows.flatMap((r) => (pick(r) ? [pick(r) as string] : []))),
    ].sort((a, b) => collator.compare(a, b));
  return {
    accounts: uniq((d) => d.account),
    projects: uniq((d) => d.project),
    dms: named ? uniq((d) => d.dm) : [],
    santexLeads: named ? uniq((d) => d.santexLead) : [],
  };
}
