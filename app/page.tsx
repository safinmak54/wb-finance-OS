import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { landingPathFor } from "@/lib/auth/permissions";

/**
 * Root route. Middleware has already redirected anonymous users to /login,
 * so by the time we reach here we have an authenticated user — we just
 * need to send them to their role's landing page.
 */
export default async function RootPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/no-role");
  redirect(landingPathFor(profile.role));
}
