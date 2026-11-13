import { describe, expect, it } from "vitest";
import type { ActorContext } from "@/modules/actor/types";
import { canRead, canWrite, type VisibilityRequest } from "./visibility";

const BRUNO = "b";
const ANA = "a";
const request = (
  overrides: Partial<VisibilityRequest> = {},
): VisibilityRequest => ({
  relationship: "self",
  reviewerPersonId: BRUNO,
  status: "draft",
  ...overrides,
});
const ctx = { participant: { revieweePersonId: BRUNO } };
const as = (
  personId: string | null,
  role: ActorContext["role"] = "employee",
) => ({
  personId,
  role,
});

describe("canRead", () => {
  it("lets the author read their own self review", () => {
    expect(canRead(as(BRUNO), { request: request(), ...ctx })).toBe(true);
  });
  it("lets HR read every review", () => {
    expect(canRead(as(null, "hr"), { request: request(), ...ctx })).toBe(true);
  });
  it("hides a self review from other people (manager side comes in #12)", () => {
    expect(canRead(as(ANA), { request: request(), ...ctx })).toBe(false);
    expect(canRead(as(ANA, "manager"), { request: request(), ...ctx })).toBe(
      false,
    );
    expect(canRead(as(null), { request: request(), ...ctx })).toBe(false);
  });
  it("lets the reviewer of a non-self review read it, nobody else", () => {
    const peer = request({ relationship: "peer", reviewerPersonId: ANA });
    expect(canRead(as(ANA, "peer"), { request: peer, ...ctx })).toBe(true);
    expect(canRead(as(BRUNO), { request: peer, ...ctx })).toBe(false);
  });
});

describe("canWrite", () => {
  it("lets only the reviewer write, and only while in draft", () => {
    expect(canWrite(as(BRUNO), request())).toBe(true);
    expect(canWrite(as(BRUNO), request({ status: "submitted" }))).toBe(false);
    expect(canWrite(as(ANA), request())).toBe(false);
    expect(canWrite(as(null, "hr"), request())).toBe(false);
  });
});
