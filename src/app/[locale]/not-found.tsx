import { SearchX } from "lucide-react";
import { useTranslations } from "next-intl";
import { IconTile } from "@/components/experience";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("Experience");
  return (
    <section className="admin-surface flex max-w-xl flex-col items-start gap-5">
      <IconTile>
        <SearchX />
      </IconTile>
      <h1 className="text-2xl">{t("notFound")}</h1>
      <Link className="button-outline" href="/">
        {t("back")}
      </Link>
    </section>
  );
}
