import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import { canOpenParticipant } from "./authz";

const bruno = "11111111-1111-4111-8111-111111111111";
const dora = "22222222-2222-4222-8222-222222222222";
const eli = "33333333-3333-4333-8333-333333333333";
const participant = { revieweePersonId: dora, snapManagerPersonId: bruno };

describe("canOpenParticipant", () => {
  it("lets People open anybody's assessment", () => {
    expect(
      canOpenParticipant({ personId: null, role: "hr" }, participant),
    ).toBe(true);
  });

  it("lets a manager open their snapshot reports' and their own, not anyone else's", () => {
    const manager = (personId: string): ActorContext => ({
      personId,
      role: "manager",
    });
    expect(canOpenParticipant(manager(bruno), participant)).toBe(true);
    expect(canOpenParticipant(manager(dora), participant)).toBe(true);
    expect(canOpenParticipant(manager(eli), participant)).toBe(false);
  });

  it("lets an employee open only their own", () => {
    expect(
      canOpenParticipant({ personId: dora, role: "employee" }, participant),
    ).toBe(true);
    // Not even as the snapshot manager: employees read only themselves.
    expect(
      canOpenParticipant({ personId: bruno, role: "employee" }, participant),
    ).toBe(false);
    expect(
      canOpenParticipant({ personId: eli, role: "employee" }, participant),
    ).toBe(false);
  });

  it("refuses direction and an actor without a person", () => {
    expect(
      canOpenParticipant({ personId: null, role: "direction" }, participant),
    ).toBe(false);
    expect(
      canOpenParticipant({ personId: null, role: "manager" }, participant),
    ).toBe(false);
    expect(
      canOpenParticipant({ personId: null, role: "employee" }, participant),
    ).toBe(false);
  });
});
