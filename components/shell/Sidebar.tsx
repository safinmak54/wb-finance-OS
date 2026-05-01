import { SidebarNav } from "./SidebarNav";
import type { Role } from "@/lib/auth/permissions";

type Props = {
  role: Role;
};

export function Sidebar({ role }: Props) {
  return (
    <aside className="flex h-screen w-[var(--layout-sidebar-w)] shrink-0 flex-col overflow-y-auto bg-sidebar text-sidebar-foreground shadow-[2px_0_12px_rgba(0,0,0,0.15)]">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 text-sm font-bold tracking-tight">
          WB
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">WB Brands</span>
          <span className="text-[11px] text-white/60">Finance OS</span>
        </div>
      </div>

      <SidebarNav role={role} />

      <div className="mt-auto border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-white/60">
          <span className="h-1.5 w-1.5 rounded-full bg-success-bright" />
          <span>Connected</span>
        </div>
      </div>
    </aside>
  );
}
