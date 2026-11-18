"use client";

import { UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/form-helpers";
import { Button } from "@/components/ui/button";
import type { ActorExamples } from "@/modules/actor/queries";
import {
  type ActorContext,
  type ActorRole,
  actorRoles,
} from "@/modules/actor/types";

/** People listed in the person select at most (a search narrows them). */
const MAX_OPTIONS = 50;

/** Header control: pick the person and role the app acts as (no login). */
export function ActorSelector({
  actor,
  actorName,
  people,
  examples,
  setActor,
}: {
  actor: ActorContext;
  actorName: string | null;
  people: { id: string; displayName: string }[];
  examples: ActorExamples;
  setActor: (personId: string | null, role: ActorRole) => Promise<ActionResult>;
}) {
  const t = useTranslations("Actor");
  const id = useId();
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState(actor.personId ?? "");
  const [role, setRole] = useState<ActorRole>(actor.role);
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLocaleLowerCase();
  // Without a search, the first people are listed so one can be picked
  // right away; a search narrows the list (the current person always stays).
  const matches = people
    .filter(
      (p) =>
        p.id === personId ||
        q === "" ||
        p.displayName.toLocaleLowerCase().includes(q),
    )
    .slice(0, MAX_OPTIONS);
  const name =
    actorName ??
    (actor.role === "hr"
      ? t("hrName")
      : actor.role === "direction"
        ? t("roles.direction")
        : t("noPerson"));
  const current =
    actorName && actor.role !== "employee"
      ? `${actorName} (${t(`roles.${actor.role}`)})`
      : name;
  // Direction acts without a person: only aggregates, nobody in particular.
  const noPerson = role === "direction";

  function actAs(next: string | null, nextRole: ActorRole) {
    startTransition(async () => {
      const result = await setActor(next, nextRole);
      setError(!result.ok);
    });
  }

  function apply() {
    actAs(noPerson ? null : personId || null, role);
  }

  const presets: { key: string; label: string; run: () => void }[] = [
    { key: "hr", label: t("roles.hr"), run: () => actAs(null, "hr") },
    ...(examples.manager
      ? [
          {
            key: "manager",
            label: t("example", {
              role: t("roles.manager"),
              name: examples.manager.displayName,
            }),
            run: () => actAs(examples.manager?.id ?? null, "manager"),
          },
        ]
      : []),
    ...(examples.employee
      ? [
          {
            key: "employee",
            label: t("example", {
              role: t("roles.employee"),
              name: examples.employee.displayName,
            }),
            run: () => actAs(examples.employee?.id ?? null, "employee"),
          },
        ]
      : []),
    {
      key: "direction",
      label: t("roles.direction"),
      run: () => actAs(null, "direction"),
    },
  ];

  return (
    <form
      aria-label={t("label")}
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <span className="mr-1 inline-flex h-9 items-center gap-2 rounded-lg bg-brand-fog px-3 text-brand-900">
        <UserRound
          className="size-4 text-brand-700"
          strokeWidth={1.6}
          aria-hidden="true"
        />
        <span className="font-medium">{t("current", { name: current })}</span>
      </span>
      <label htmlFor={`${id}-q`} className="sr-only">
        {t("search")}
      </label>
      <input
        id={`${id}-q`}
        type="text"
        className="control w-40 placeholder:text-muted-foreground"
        placeholder={t("search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <label htmlFor={`${id}-person`} className="sr-only">
        {t("person")}
      </label>
      <select
        id={`${id}-person`}
        className="control max-w-48"
        value={noPerson ? "" : personId}
        disabled={noPerson}
        onChange={(e) => setPersonId(e.target.value)}
      >
        <option value="">{t("noPerson")}</option>
        {matches.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-role`} className="sr-only">
        {t("role")}
      </label>
      <select
        id={`${id}-role`}
        className="control"
        value={role}
        onChange={(e) => setRole(e.target.value as ActorRole)}
      >
        {actorRoles.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
      <Button type="submit" size="lg" disabled={pending}>
        {t("apply")}
      </Button>
      <span className="flex basis-full flex-wrap items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{t("examples")}</span>
        {presets.map((p) => (
          <button
            key={p.key}
            type="button"
            className="rounded-full border border-brand-200 px-2.5 py-0.5 text-brand-900 hover:bg-brand-fog disabled:opacity-50"
            disabled={pending}
            onClick={p.run}
          >
            {p.label}
          </button>
        ))}
      </span>
      {error ? (
        <span role="alert" className="text-destructive">
          {t("error")}
        </span>
      ) : null}
    </form>
  );
}
