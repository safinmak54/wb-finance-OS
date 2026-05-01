import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in — WB Brands Finance OS" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8 shadow-card">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-lg bg-primary text-primary-foreground text-lg font-bold tracking-tight">
            WB
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-foreground">
              WB Brands Finance OS
            </h1>
            <p className="mt-1 text-xs text-muted">
              Sign in with your work email
            </p>
          </div>
        </div>

        <LoginForm next={next} />

        <div className="mt-6 flex items-center justify-center gap-3 text-[11px] uppercase tracking-wider text-subtle">
          <span>COO</span>
          <span>·</span>
          <span>Bookkeeper</span>
          <span>·</span>
          <span>CPA</span>
          <span>·</span>
          <span className="text-purple">Admin</span>
        </div>
      </div>
    </main>
  );
}
