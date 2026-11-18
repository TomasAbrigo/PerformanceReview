"use client";

import Image from "next/image";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { NavIcon } from "./nav-icon";
import type { NavGroup } from "./nav-items";

/**
 * Sidebar on wide screens, a scrollable strip under the logo on narrow ones:
 * the same links either way. The current section is marked with aria-current.
 */
export function SideNavClient({
  groups,
  label,
  home,
  company,
  tagline,
}: {
  groups: NavGroup[];
  label: string;
  home: string;
  company: string;
  tagline: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav
      aria-label={label}
      className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:overflow-y-auto"
    >
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
      <div className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
        {groups.map((group) => (
          <div
            key={group.key}
            className="flex shrink-0 items-center gap-1 lg:flex-col lg:items-stretch lg:gap-0.5 lg:pt-5"
          >
            <p className="kicker hidden px-3 pb-2 text-brand-400 lg:block">
              {group.title}
            </p>
            {group.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                    active &&
                      "bg-sidebar-accent text-sidebar-accent-foreground",
                  )}
                >
                  <NavIcon
                    icon={item.key}
                    className={cn(
                      "size-4 shrink-0",
                      active ? "text-brand-600" : "text-brand-400",
                    )}
                  />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
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
