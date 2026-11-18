"use client";

import { ChevronDown, House, Menu, X } from "lucide-react";
import Image from "next/image";
import { type ReactNode, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import type { NavGroup, NavItem } from "./nav-items";

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

/** One entry of the sidebar: the canvas item (icon, label, soft fill when current). */
function NavLink({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "side-nav-item",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

/**
 * The sidebar, as the approved canvas draws it: the wordmark and the product
 * kicker, Inicio, then one section per group (Personas, Análisis,
 * Administración) with a small uppercase title and its entries. On wide
 * screens everything is visible; on narrow ones the menu opens from a button
 * and each section collapses (the one you are in starts open). The current
 * section is marked with aria-current.
 */
export function SideNavClient({
  groups,
  label,
  product,
  home,
  people,
  menu,
  company,
  tagline,
}: {
  groups: NavGroup[];
  label: string;
  product: string;
  home: string;
  people: string;
  menu: string;
  company: string;
  tagline: string;
}) {
  const pathname = usePathname();
  // The menu stays open only on the page it was opened on (navigating closes it).
  const [opened, setOpened] = useState<string | null>(null);
  const menuOpen = opened === pathname;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // Goals and Assessments share the "Personas" section; the rest keep their own.
  const primary = groups.filter((g) => g.primary);
  const sections: { key: string; title: string; items: NavItem[] }[] = [
    ...(primary.length > 0
      ? [
          {
            key: "people",
            title: people,
            items: primary.flatMap((g) => g.items),
          },
        ]
      : []),
    ...groups.filter((g) => !g.primary),
  ];
  const hasActive = (items: NavItem[]) =>
    items.some((item) => isActive(pathname, item.href));
  const expanded = (section: (typeof sections)[number]) =>
    !(collapsed[section.key] ?? !hasActive(section.items));

  return (
    <nav aria-label={label} className="side-nav">
      <div className="side-nav-inner">
        <div className="flex items-center justify-between pr-4 lg:block lg:pr-0">
          <Link
            href="/"
            aria-label={company}
            className="flex flex-col gap-2 px-5 pt-8 pb-5 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Image
              src="/brand/santex-wordmark-white.png"
              alt={company}
              width={588}
              height={126}
              priority
              className="h-6 w-auto self-start"
            />
            <span className="side-nav-kicker">{product}</span>
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
            "flex-col gap-1 px-5 pb-4 lg:flex lg:pb-0",
            menuOpen ? "flex" : "hidden",
          )}
        >
          <NavLink
            href="/"
            active={pathname === "/"}
            icon={
              <House
                strokeWidth={1.6}
                aria-hidden="true"
                className="size-4 shrink-0 text-brand-200"
              />
            }
          >
            {home}
          </NavLink>
          {sections.map((section) => {
            const open = expanded(section);
            const listId = `side-nav-${section.key}`;
            return (
              <div key={section.key} className="flex flex-col gap-0.5 pt-2">
                <p className="side-nav-kicker hidden px-2 pb-1.5 lg:block">
                  {section.title}
                </p>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [section.key]: open }))
                  }
                  className="side-nav-kicker flex items-center justify-between rounded-lg px-2 py-2 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring lg:hidden"
                >
                  {section.title}
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
                  {section.items.map((item) => (
                    <NavLink
                      key={item.key}
                      href={item.href}
                      active={isActive(pathname, item.href)}
                      icon={
                        <NavIcon
                          icon={item.key}
                          className="size-4 shrink-0 text-brand-200"
                        />
                      }
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-auto hidden flex-col gap-1 px-5 pt-5 pb-10 text-xs text-brand-200 lg:flex">
          <p>{company}</p>
          <p>{tagline}</p>
        </div>
      </div>
    </nav>
  );
}
