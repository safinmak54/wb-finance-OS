import { PageSkeleton } from "@/components/shell/PageSkeleton";

/**
 * Suspense fallback for every page in the (app) group. Next.js shows this
 * while a page's server component awaits its data, giving each page the
 * loading state Epic 1 requires without a per-page file.
 */
export default function AppLoading() {
  return <PageSkeleton />;
}
