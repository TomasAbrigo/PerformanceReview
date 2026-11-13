"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import {
  validateAgainstSchema,
  type ProfileEntity,
  type SourceProfile,
} from "@/modules/lake/profiles";
import {
  UPLOAD_EXTENSIONS,
  UPLOAD_MAX_BYTES,
  type ImportResult,
  type InspectResult,
  type UploadErrorCode,
} from "@/modules/lake/upload-shared";
import { NativeSelect } from "./native-select";
import {
  buildProfile,
  emptyDraft,
  ProfileEditor,
  type ProfileDraft,
} from "./upload-profile-editor";
import { ColumnsTable, IssueList, RowsTable } from "./upload-preview";
import { UploadResult } from "./upload-result";

/** The server actions the form drives (injected, so the form is testable). */
export type UploadActions = {
  inspect: (formData: FormData) => Promise<InspectResult>;
  importFile: (input: {
    uploadId: string;
    fileName: string;
    profile: SourceProfile;
  }) => Promise<ImportResult>;
};

type Inspected = Extract<InspectResult, { ok: true }>;
type Imported = Extract<ImportResult, { ok: true }>;

type Phase =
  | { step: "choose" }
  | { step: "preview"; file: Inspected }
  | { step: "done"; result: Imported };

const NEW_PROFILE = "__new__";
const MAX_MB = UPLOAD_MAX_BYTES / (1024 * 1024);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload flow: choose a file, preview its columns and first rows against a
 * source profile (built-in, saved or new), import, then go to the run's page
 * (`/imports/runs/<id>`), with a simple inline result in the meantime.
 */
export function UploadForm({
  profiles: initialProfiles,
  actions,
}: {
  profiles: SourceProfile[];
  actions: UploadActions;
}) {
  const t = useTranslations("Upload");
  const [phase, setPhase] = useState<Phase>({ step: "choose" });
  const [profiles, setProfiles] = useState(initialProfiles);
  const [error, setError] = useState<UploadErrorCode | "unknown" | null>(null);
  const [pending, startTransition] = useTransition();
  const fileId = useId();
  const router = useRouter();

  const errorText = (code: UploadErrorCode | "unknown") =>
    t(`errors.${code}`, { max: MAX_MB });

  function preview(file: File | undefined) {
    if (!file) {
      setError("no_file");
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setError("file_too_large");
      return;
    }
    if (
      !UPLOAD_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))
    ) {
      setError("unsupported_type");
      return;
    }
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await actions.inspect(formData);
      if (result.ok) setPhase({ step: "preview", file: result });
      else setError(result.code);
    });
  }

  if (phase.step === "done") {
    return (
      <UploadResult
        result={phase.result}
        onReset={() => {
          setError(null);
          setPhase({ step: "choose" });
        }}
      />
    );
  }

  if (phase.step === "preview") {
    return (
      <Preview
        file={phase.file}
        profiles={profiles}
        pending={pending}
        error={error ? errorText(error) : null}
        onBack={() => {
          setError(null);
          setPhase({ step: "choose" });
        }}
        onImport={(profile, isNew) => {
          setError(null);
          startTransition(async () => {
            const result = await actions.importFile({
              uploadId: phase.file.uploadId,
              fileName: phase.file.fileName,
              profile,
            });
            if (!result.ok) {
              setError(result.code);
              return;
            }
            if (isNew) setProfiles((all) => [...all, profile]);
            setPhase({ step: "done", result });
            // The run's page has the full detail; the result below stays
            // as the fallback while it loads.
            router.push(`/imports/runs/${result.runId}`);
          });
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        aria-label={t("choose.title")}
        className="flex max-w-xl flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          preview(
            e.currentTarget.querySelector<HTMLInputElement>("input[type=file]")
              ?.files?.[0],
          );
        }}
      >
        <Field>
          <FieldLabel htmlFor={fileId}>{t("choose.fileLabel")}</FieldLabel>
          <Input
            id={fileId}
            type="file"
            name="file"
            accept={UPLOAD_EXTENSIONS.join(",")}
          />
          <FieldDescription>
            {t("choose.hint", { max: MAX_MB })}
          </FieldDescription>
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("choose.reading") : t("choose.submit")}
          </Button>
        </div>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error)}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{t("choose.empty")}</p>
      )}
    </div>
  );
}

function Preview({
  file,
  profiles,
  pending,
  error,
  onBack,
  onImport,
}: {
  file: Inspected;
  profiles: SourceProfile[];
  pending: boolean;
  error: string | null;
  onBack: () => void;
  onImport: (profile: SourceProfile, isNew: boolean) => void;
}) {
  const t = useTranslations("Upload");
  const selectId = useId();
  const issuesOf = (profile: SourceProfile) =>
    validateAgainstSchema(profile, file.columns);

  // Start on the first profile the file already satisfies, if any.
  const [selected, setSelected] = useState(
    () => profiles.find((p) => issuesOf(p).length === 0)?.name ?? "",
  );
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);

  const isNew = selected === NEW_PROFILE;
  const built = useMemo(
    () => buildProfile(draft, file.columns),
    [draft, file.columns],
  );
  const profile = isNew
    ? built.profile
    : (profiles.find((p) => p.name === selected) ?? null);
  const issues = profile ? issuesOf(profile) : [];
  const canImport = profile !== null && issues.length === 0 && !pending;

  return (
    <section aria-labelledby="upload-preview" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="upload-preview" className="text-lg font-semibold">
          {t("preview.title")}
        </h2>
        <p className="text-sm">
          {t("preview.file", {
            name: file.fileName,
            size: formatSize(file.size),
          })}
        </p>
        {file.existed ? (
          <p className="text-sm text-muted-foreground">
            {t("preview.existed")}
          </p>
        ) : null}
      </div>

      <Field className="max-w-xl">
        <FieldLabel htmlFor={selectId}>{t("preview.profile")}</FieldLabel>
        <NativeSelect
          id={selectId}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">{t("preview.chooseProfile")}</option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name}>
              {t("preview.profileOption", {
                name: p.name,
                entity: t(`entities.${p.entity as ProfileEntity}`),
              })}
            </option>
          ))}
          <option value={NEW_PROFILE}>{t("preview.newProfile")}</option>
        </NativeSelect>
        {profile && issues.length === 0 ? (
          <FieldDescription>{t("preview.matches")}</FieldDescription>
        ) : null}
      </Field>

      {isNew ? (
        <ProfileEditor
          columns={file.columns}
          draft={draft}
          onChange={setDraft}
          errors={built.errors}
        />
      ) : null}

      <IssueList issues={issues} />

      {isNew ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("preview.columns")}</h3>
          <ColumnsTable
            columns={file.columns}
            profile={profile}
            issues={issues}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">{t("preview.rows")}</h3>
        <RowsTable columns={file.columns} rows={file.rows} issues={issues} />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {profile && issues.length > 0 ? (
        <p className="text-sm text-muted-foreground">{t("preview.blocked")}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canImport}
          onClick={() => profile && onImport(profile, isNew)}
        >
          {pending ? t("preview.importing") : t("preview.import")}
        </Button>
        <Button variant="outline" disabled={pending} onClick={onBack}>
          {t("preview.another")}
        </Button>
      </div>
    </section>
  );
}
