import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listInvoices } from "@/lib/queries/invoices";
import { listVendors } from "@/lib/queries/vendors";
import { InvoicesClient } from "./InvoicesClient";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const supabase = createDataClient();
  const [invoices, vendors] = await Promise.all([
    listInvoices(supabase),
    listVendors(supabase),
  ]);

  return (
    <PageShell page="invoices" title="Invoices" subtitle={`${invoices.length} invoices`}>
      <InvoicesClient invoices={invoices} vendors={vendors} />
    </PageShell>
  );
}
