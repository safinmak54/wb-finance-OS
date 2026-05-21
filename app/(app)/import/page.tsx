import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listBankConnections } from "@/lib/queries/cash";
import { getCurrentProfile } from "@/lib/auth/profile";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const supabase = createDataClient();
  const [banks, profile] = await Promise.all([
    listBankConnections(supabase),
    getCurrentProfile(),
  ]);
  return (
    <PageShell
      page="import"
      title="Import data"
      subtitle="Upload bank or credit-card statements (CSV or XLSX)"
    >
      <ImportClient banks={banks} isAdmin={profile?.role === "admin"} />
    </PageShell>
  );
}
