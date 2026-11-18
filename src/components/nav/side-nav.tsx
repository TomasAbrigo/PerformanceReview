import { getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { actorIsHr } from "@/modules/actor/server";
import { navGroups } from "./nav-items";
import { SideNavClient } from "./side-nav-client";

/** The sidebar (server part: which groups the actor gets). */
export async function SideNav() {
  await connection();
  const [t, hr] = await Promise.all([getTranslations(), actorIsHr()]);
  return (
    <SideNavClient
      groups={navGroups(t, hr)}
      label={t("Nav.label")}
      home={t("Nav.home")}
      company={t("Brand.company")}
      tagline={t("Brand.tagline")}
    />
  );
}
