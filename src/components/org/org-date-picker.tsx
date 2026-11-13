import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** GET form: submitting navigates to ?date=YYYY-MM-DD (works without JS). */
export function OrgDatePicker({ date }: { date: string }) {
  const t = useTranslations("Org");
  return (
    <form method="get" className="flex items-end gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor="org-date">{t("dateLabel")}</Label>
        <Input
          id="org-date"
          type="date"
          name="date"
          defaultValue={date}
          required
          className="w-44"
        />
      </div>
      <Button type="submit">{t("show")}</Button>
    </form>
  );
}
