import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listVendors } from "@/lib/queries/vendors";
import { VendorsClient } from "./VendorsClient";

export const dynamic = "force-dynamic";

export default async function VendorsPage() {
  const supabase = createDataClient();
  const vendors = await listVendors(supabase);

  return (
    <PageShell
      page="vendors"
      title="Vendors"
      subtitle={`${vendors.length} ${vendors.length === 1 ? "vendor" : "vendors"}`}
    >
      <VendorsClient vendors={vendors} />
    </PageShell>
  );
}
