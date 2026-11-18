"use client";

import { ChevronDown, Menu, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import type { NavGroup, NavItem } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function NavLink({
  item,
  active,
  primary = false,
}: {
  item: NavItem;
  active: boolean;
  primary?: boolean;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 text-sm whitespace-nowrap transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        primary ? "py-2.5 text-[15px] font-medium" : "py-2",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <NavIcon
        icon={item.key}
        className={cn(
          "shrink-0",
          primary ? "size-5" : "size-4",
          active ? "text-brand-600" : "text-brand-400",
        )}
      />
      {item.label}
    </Link>
  );
}

/**
 * The sidebar. Goals and Assessments come first, as big entries; the
 * analysis, data and settings follow under their own section labels. On wide
 * screens everything is visible; on narrow ones the menu opens from a button
 * and each section collapses (the one you are in starts open). The current
 * section is marked with aria-current.
 */
export function SideNavClient({
  groups,
  label,
  home,
  menu,
  company,
  tagline,
}: {
  groups: NavGroup[];
  label: string;
  home: string;
  menu: string;
  company: string;
  tagline: string;
}) {
  const pathname = usePathname();
  // The menu stays open only on the page it was opened on (navigating closes it).
  const [opened, setOpened] = useState<string | null>(null);
  const menuOpen = opened === pathname;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const primary = groups.filter((g) => g.primary);
  const sections = groups.filter((g) => !g.primary);
  const hasActive = (group: NavGroup) =>
    group.items.some((item) => isActive(pathname, item.href));
  const expanded = (group: NavGroup) =>
    !(collapsed[group.key] ?? !hasActive(group));

  return (
    <nav
      aria-label={label}
      className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:overflow-y-auto"
    >
      <div className="flex items-center justify-between pr-4 lg:block lg:pr-0">
        <Link
          href="/"
          aria-label={home}
          aria-current={pathname === "/" ? "page" : undefined}
          className="flex items-center px-6 pt-6 pb-4 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <Image
            src="/brand/santex-wordmark-white.png"
            alt={company}
            width={588}
            height={126}
            priority
            className="h-6 w-auto"
          />
        </Link>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="side-nav-sections"
          onClick={() => setOpened(menuOpen ? null : pathname)}
          className="mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring lg:hidden"
        >
          {menuOpen ? (
            <X className="size-4" aria-hidden="true" />
          ) : (
            <Menu className="size-4" aria-hidden="true" />
          )}
          {menu}
        </button>
      </div>
      <div
        id="side-nav-sections"
        className={cn(
          "flex-col gap-1 px-3 pb-4 lg:flex lg:pb-0",
          menuOpen ? "flex" : "hidden",
        )}
      >
        {primary.length > 0 ? (
          <div className="flex flex-col gap-1 border-b border-sidebar-border pb-3">
            {primary.map((group) =>
              group.items.map((item) => (
                <NavLink
                  key={item.key}
                  item={item}
                  primary
                  active={isActive(pathname, item.href)}
                />
              )),
            )}
          </div>
        ) : null}
        {sections.map((group) => {
          const open = expanded(group);
          const listId = `side-nav-${group.key}`;
          return (
            <div key={group.key} className="flex flex-col gap-0.5 lg:pt-4">
              <p className="kicker hidden px-3 pb-2 text-brand-400 lg:block">
                {group.title}
              </p>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={listId}
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [group.key]: open }))
                }
                className="kicker flex items-center justify-between rounded-lg px-3 py-2 text-brand-400 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring lg:hidden"
              >
                {group.title}
                <ChevronDown
                  className={cn(
                    "size-4 transition-transform",
                    open && "rotate-180",
                  )}
                  aria-hidden="true"
                />
              </button>
              <div
                id={listId}
                className={cn(
                  "flex-col gap-0.5 lg:flex",
                  open ? "flex" : "hidden",
                )}
              >
                {group.items.map((item) => (
                  <NavLink
                    key={item.key}
                    item={item}
                    active={isActive(pathname, item.href)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-auto hidden border-t border-sidebar-border px-6 pt-5 pb-16 lg:block">
        <p className="text-xs text-brand-400">{company}</p>
        <p className="font-heading text-sm text-sidebar-accent-foreground/80">
          {tagline}
        </p>
      </div>
    </nav>
  );
}
