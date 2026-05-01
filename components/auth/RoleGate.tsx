import {
  canDoAction,
  canViewPage,
  type ActionId,
  type PageId,
  type Role,
} from "@/lib/auth/permissions";

type Props = {
  role: Role | null;
  children: React.ReactNode;
  /** Show only if the role can view this page. */
  page?: PageId;
  /** Show only if the role can perform this action. */
  action?: ActionId;
  /** Optional fallback to render when access is denied. */
  fallback?: React.ReactNode;
};

/**
 * Server Component (no client JS) that renders its children only when the
 * given role passes the page or action check. Use for action buttons,
 * dashboard cards, sidebar items, etc.
 *
 * Note: this is a UX nicety, not a security boundary. Authoritative checks
 * happen in middleware.ts and at the data layer in Server Actions.
 */
export function RoleGate({ role, children, page, action, fallback = null }: Props) {
  if (page && !canViewPage(role, page)) return <>{fallback}</>;
  if (action && !canDoAction(role, action)) return <>{fallback}</>;
  return <>{children}</>;
}
