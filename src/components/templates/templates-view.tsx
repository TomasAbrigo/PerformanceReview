"use client";

import { Copy, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import {
  type ActionResult,
  ErrorAlert,
  type Localized,
  LocalizedInputs,
  useAction,
  useLocalized,
} from "./shared";

export type TemplateRow = {
  id: string;
  name: Localized;
  isSystem: boolean;
  enabled: boolean;
};
export type TemplatesActions = {
  create: (input: { name: Localized }) => Promise<ActionResult<{ id: string }>>;
  clone: (id: string) => Promise<ActionResult<{ id: string }>>;
  remove: (id: string) => Promise<ActionResult>;
};

export function TemplatesView({
  templates,
  actions,
}: {
  templates: TemplateRow[];
  actions: TemplatesActions;
}) {
  const t = useTranslations("Templates");
  const tc = useTranslations("Common");
  const localized = useLocalized();
  const router = useRouter();
  const { pending, error, run } = useAction();
  const open = (r: { id: string }) =>
    router.push(`/settings/templates/${r.id}`);

  return (
    <div className="flex flex-col gap-6">
      <ErrorAlert error={error} />
      {templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead className="text-right">{tc("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/settings/templates/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {localized(row.name)}
                    </Link>
                    {row.isSystem ? (
                      <Badge variant="secondary">{tc("system")}</Badge>
                    ) : null}
                    {row.enabled ? null : (
                      <Badge variant="outline">{tc("disabled")}</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("cloneTemplate")}
                    disabled={pending}
                    onClick={() => run(() => actions.clone(row.id), open)}
                  >
                    <Copy />
                  </Button>
                  {row.isSystem ? null : (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("deleteTemplate")}
                      disabled={pending}
                      onClick={() => run(() => actions.remove(row.id))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <CreateForm create={actions.create} onCreated={open} />
    </div>
  );
}

function CreateForm({
  create,
  onCreated,
}: {
  create: TemplatesActions["create"];
  onCreated: (r: { id: string }) => void;
}) {
  const t = useTranslations("Templates");
  const tc = useTranslations("Common");
  const id = useId();
  const [name, setName] = useState<Localized>({ es: "", en: "" });
  const { pending, error, run, issueAt } = useAction();
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("new")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          aria-label={t("new")}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => create({ name }), onCreated);
          }}
        >
          <LocalizedInputs
            id={id}
            labels={{ es: tc("nameEs"), en: tc("nameEn") }}
            value={name}
            onChange={setName}
            issueAt={issueAt}
            path="name"
          />
          <div>
            <Button type="submit" disabled={pending}>
              {t("create")}
            </Button>
          </div>
          <ErrorAlert error={error?.code === "validation" ? null : error} />
        </form>
      </CardContent>
    </Card>
  );
}
