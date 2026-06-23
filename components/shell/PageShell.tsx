import { redirect } from "next/navigation";
import { Topbar } from "./Topbar";
import { canViewPage, type PageId } from "@/lib/auth/permissions";
import { getCurrentProfile } from "@/lib/auth/profile";
import { cn } from "@/lib/utils/cn";

type Props = {
  page: PageId;
  title: string;
  subtitle?: string;
  /**
   * Tightens the content area's vertical padding. Use for dense pages (e.g.
   * the dashboard) that should fit above the fold without scrolling.
   */
  compact?: boolean;
  children: React.ReactNode;
};

/**
 * Wraps a page with the topbar + content area, and enforces the role gate
 * server-side. If the user lacks access, they are redirected to `/`, which
 * in turn lands them on their role's default page.
 */
export async function PageShell({
  page,
  title,
  subtitle,
  compact = false,
  children,
}: Props) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!canViewPage(profile.role, page)) redirect("/");

  return (
    <>
      <Topbar profile={profile} pageTitle={title} pageSubtitle={subtitle} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto max-w-[1400px] px-5",
            compact ? "py-3" : "py-6",
          )}
        >
          {children}
        </div>
      </main>
    </>
  );
}
