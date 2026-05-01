import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Sidebar } from "@/components/shell/Sidebar";
import { ToastProvider } from "@/components/ui/Toast";
import { AdvisorPanel } from "@/components/ai/AdvisorPanel";
import { RoleGate } from "@/components/auth/RoleGate";
import { getCurrentProfile } from "@/lib/auth/profile";

/**
 * App-shell layout — guarantees an authenticated user with a known role.
 * Per-page chrome (page title, page subtitle, topbar) lives inside each page
 * via the `<PageShell>` component, so each page can declare its own header.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/no-role");

  return (
    <ToastProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-background">
        <Sidebar role={profile.role} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <RoleGate role={profile.role} action="ai-advisor">
        <Suspense fallback={null}>
          <AdvisorPanel />
        </Suspense>
      </RoleGate>
    </ToastProvider>
  );
}
