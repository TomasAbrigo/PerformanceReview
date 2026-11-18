import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { getActor } from "@/modules/actor/server";
import { navGroups } from "./nav-items";
import { SideNavClient } from "./side-nav-client";

/** The sidebar (server part: which groups the actor gets). */
export async function SideNav() {
  await connection();
  const [t, actor] = await Promise.all([getTranslations(), getActor()]);
  return (
    <SideNavClient
      groups={navGroups(t, actor)}
      label={t("Nav.label")}
      product={t("Nav.product")}
      home={t("Nav.home")}
      people={t("Nav.people")}
      menu={t("Nav.menu")}
      company={t("Brand.company")}
      tagline={t("Brand.tagline")}
    />
  );
}
