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
 * An opaque, stable key for a group whose value names a person, so direction
 * can tell two teams apart (and match them across cycles) without a name.
 * FNV-1a, two lanes; not a secret, a name that was never shown stays unshown.
 */
export function opaqueKey(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c, 0x85ebca6b) >>> 0;
  }
  return `g${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

/** The value a group exposes: its own for most kinds, an opaque key for people when masked. */
export function groupIdentity(
  kind: OrgGroupBy,
  value: string | null,
  masked: boolean,
): { key: string | null; label: string | null } {
  if (value === null) return { key: null, label: null };
  if (masked && isPersonKind(kind)) {
    return { key: opaqueKey(value), label: null };
  }
  return { key: value, label: value };
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
