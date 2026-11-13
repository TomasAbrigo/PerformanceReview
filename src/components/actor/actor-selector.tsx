"use client";

import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/components/templates/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import {
  type ActorContext,
  type ActorRole,
  actorRoles,
} from "@/modules/actor/types";

const selectClass =
  "h-8 rounded-md border bg-transparent px-2 text-sm dark:bg-input/30";

/** Header control: pick the person and role the app acts as (no login). */
export function ActorSelector({
  actor,
  actorName,
  people,
  setActor,
}: {
  actor: ActorContext;
  actorName: string | null;
  people: { id: string; displayName: string }[];
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
  const matches = people.filter(
    (p) =>
      p.id === personId || !q || p.displayName.toLocaleLowerCase().includes(q),
  );
  const name = actorName ?? (actor.role === "hr" ? t("hrName") : t("noPerson"));
  const current =
    actorName && actor.role !== "employee"
      ? `${actorName} (${t(`roles.${actor.role}`)})`
      : name;

  function apply() {
    startTransition(async () => {
      const result = await setActor(personId || null, role);
      setError(!result.ok);
    });
  }

  return (
    <form
      aria-label={t("label")}
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <span className="font-medium">{t("current", { name: current })}</span>
      <label htmlFor={`${id}-q`} className="sr-only">
        {t("search")}
      </label>
      <Input
        id={`${id}-q`}
        type="text"
        className="h-8 w-36"
        placeholder={t("search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <label htmlFor={`${id}-person`} className="sr-only">
        {t("person")}
      </label>
      <select
        id={`${id}-person`}
        className={selectClass}
        value={personId}
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
        className={selectClass}
        value={role}
        onChange={(e) => setRole(e.target.value as ActorRole)}
      >
        {actorRoles.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" disabled={pending}>
        {t("apply")}
      </Button>
      <Link href="/me" className="underline">
        {t("myTasks")}
      </Link>
      {error ? (
        <span role="alert" className="text-destructive">
          {t("error")}
        </span>
      ) : null}
    </form>
  );
}
