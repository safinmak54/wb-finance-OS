import { logout } from "@/app/login/actions";
import { RoleGate } from "@/components/auth/RoleGate";
import { EntitySwitcher } from "./EntitySwitcher";
import { PeriodPicker } from "@/components/filters/PeriodPicker";
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
        <PeriodPicker />
        <EntitySwitcher />

        <RoleGate role={profile.role} action="add-transaction">
          <a
            href="/inbox"
            className="hidden rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary-hover sm:inline-flex"
          >
            + Add Transaction
          </a>
        </RoleGate>

        <span className="hidden rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-muted sm:inline-block">
          {ROLE_LABEL[profile.role]}
        </span>

        <form action={logout}>
          <button
            type="submit"
            title="Sign out"
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-surface-2 hover:text-foreground"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
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
