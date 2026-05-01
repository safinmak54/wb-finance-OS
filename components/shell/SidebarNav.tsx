"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import {
  PAGE_LABELS,
  PAGE_PATHS,
  SIDEBAR_GROUPS,
  canViewPage,
  type PageId,
  type Role,
} from "@/lib/auth/permissions";

type Props = {
  role: Role;
};

export function SidebarNav({ role }: Props) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-4 px-3 py-4">
      {SIDEBAR_GROUPS.map((group) => {
        const visible = group.pages.filter((p) => canViewPage(role, p));
        if (visible.length === 0) return null;

        return (
          <div key={group.label} className="flex flex-col gap-1">
            <div className="px-2 text-[10px] font-medium uppercase tracking-wider text-white/40">
              {group.label}
            </div>
            {visible.map((p) => (
              <SidebarLink
                key={p}
                page={p}
                isActive={isActiveLink(pathname, PAGE_PATHS[p])}
              />
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function SidebarLink({
  page,
  isActive,
}: {
  page: PageId;
  isActive: boolean;
}) {
  return (
    <Link
      href={PAGE_PATHS[page]}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-[13px] font-medium transition",
        isActive
          ? "bg-white/15 text-white"
          : "text-white/70 hover:bg-white/10 hover:text-white",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
      <span>{PAGE_LABELS[page]}</span>
    </Link>
  );
}

function isActiveLink(pathname: string, href: string) {
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}
