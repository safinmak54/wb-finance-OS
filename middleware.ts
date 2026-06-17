import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Edge middleware:
 *   1. Refreshes the Supabase session cookie on every request.
 *   2. Redirects unauthenticated users to /login.
 *   3. Redirects authenticated users away from /login.
 *
 * Page-level role gating happens in app/(app)/layout.tsx and individual
 * pages, where we can read the profile (with role) from the database.
 * Middleware runs on the Edge runtime and stays narrow on purpose.
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isPublicRoute =
    pathname === "/login" ||
    pathname === "/no-role" ||
    pathname.startsWith("/auth/") ||
    pathname === "/auth";

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname || "/");
    return NextResponse.redirect(url);
  }

  // Only bounce an authenticated user away from the login *page view* (a GET
  // navigation). A POST to /login is the sign-in Server Action — middleware
  // must not answer it with a bare redirect, because the client's action
  // handler only understands an RSC body or an `x-action-redirect` header. A
  // plain redirect surfaces as "An unexpected response was received from the
  // server." Let the action run; on success it issues its own redirect.
  if (user && pathname === "/login" && request.method === "GET") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Run on everything except Next internals, static assets, and image opt.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff2?|ttf)$).*)",
  ],
};
