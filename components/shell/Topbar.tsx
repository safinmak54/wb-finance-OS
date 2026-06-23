import { logout } from "@/app/login/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { LogoutButton } from "./LogoutButton";
import { AddTransactionButton } from "./AddTransactionButton";
import type { UserProfile } from "@/lib/auth/profile";

const ROLE_LABEL: Record<UserProfile["role"], string> = {
  coo: "COO",
  bookkeeper: "Bookkeeper",
  cpa: "CPA",
  admin: "Admin",
};

type Props = {
  profile: UserProfile;
  pageTitle: string;
  pageSubtitle?: string;
};

export function Topbar({ profile, pageTitle, pageSubtitle }: Props) {
  const initials = (profile.displayName ?? profile.email)
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "U";

  return (
    <header className="flex h-[var(--layout-topbar-h)] shrink-0 items-center justify-between border-b border-border bg-surface px-5">
      <div className="flex flex-col leading-tight">
        <h1 className="text-base font-semibold text-foreground">{pageTitle}</h1>
        {pageSubtitle ? (
          <span className="text-xs text-muted">{pageSubtitle}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <RoleGate role={profile.role} action="add-transaction">
          <AddTransactionButton />
        </RoleGate>

        <span className="hidden rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-muted sm:inline-block">
          {ROLE_LABEL[profile.role]}
        </span>

        <form action={logout}>
          <LogoutButton />
        </form>

        <div
          aria-hidden
          className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary"
        >
          {initials}
        </div>
      </div>
    </header>
  );
}
