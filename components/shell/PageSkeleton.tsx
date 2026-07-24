/**
 * Generic loading skeleton for app pages. Rendered by the (app) route-group
 * `loading.tsx`, so it appears in the content area of every authenticated page
 * while that page's server component awaits its data (Epic 1 acceptance
 * criterion: "each page loads with an empty/loading state before data
 * resolves"). The sidebar stays put — only this content region is replaced.
 */
export function PageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-live="polite">
      {/* faux topbar */}
      <div className="flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <div className="flex flex-col gap-2">
          <div className="h-4 w-40 animate-pulse rounded bg-surface-2" />
          <div className="h-2.5 w-56 animate-pulse rounded bg-surface-2" />
        </div>
        <div className="h-8 w-8 animate-pulse rounded-full bg-surface-2" />
      </div>

      {/* content shimmer */}
      <div className="mx-auto w-full max-w-[1400px] px-5 py-6">
        <span className="sr-only">Loading…</span>
        <div className="mb-4 flex gap-3">
          <div className="h-8 w-28 animate-pulse rounded-md bg-surface-2" />
          <div className="h-8 w-28 animate-pulse rounded-md bg-surface-2" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-xl border border-border bg-surface"
            />
          ))}
        </div>
        <div className="mt-4 space-y-2 rounded-xl border border-border bg-surface p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />
          ))}
        </div>
      </div>
    </div>
  );
}
