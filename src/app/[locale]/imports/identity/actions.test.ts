import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const actAs = (role: string) =>
  get.mockReturnValue({ value: JSON.stringify({ personId: null, role }) });
const resolveIssue = vi.fn();
const ignoreIssue = vi.fn();
const listPeople = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ get }) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/modules/identity", () => ({
  IdentityError: class IdentityError extends Error {},
  resolveIssue: (...a: unknown[]) => resolveIssue(...a),
  ignoreIssue: (...a: unknown[]) => ignoreIssue(...a),
}));
vi.mock("@/modules/people/queries", () => ({
  listPeople: (...a: unknown[]) => listPeople(...a),
}));

const {
  createIssueAction,
  ignoreIssueAction,
  linkIssueAction,
  searchPeopleAction,
} = await import("./actions");

beforeEach(() => {
  for (const fn of [get, resolveIssue, ignoreIssue, listPeople]) {
    fn.mockReset();
  }
});

describe("identity queue actions are People only", () => {
  it("run for HR", async () => {
    actAs("hr");
    resolveIssue.mockResolvedValue({});
    expect(await createIssueAction("i1", "")).toEqual({ ok: true });
    expect(resolveIssue).toHaveBeenCalledOnce();
    listPeople.mockResolvedValue([
      { id: "p1", displayName: "Ana García", workEmail: null },
    ]);
    expect(await searchPeopleAction("ana")).toHaveLength(1);
  });

  it.each(["manager", "employee", "direction"] as const)(
    "answer forbidden to %s and search finds nobody",
    async (role) => {
      actAs(role);
      for (const outcome of [
        await linkIssueAction("i1", "p1", ""),
        await createIssueAction("i1", ""),
        await ignoreIssueAction("i1", ""),
      ]) {
        expect(outcome).toMatchObject({ ok: false, code: "forbidden" });
      }
      expect(await searchPeopleAction("ana")).toEqual([]);
      expect(resolveIssue).not.toHaveBeenCalled();
      expect(ignoreIssue).not.toHaveBeenCalled();
      expect(listPeople).not.toHaveBeenCalled();
    },
  );
});
