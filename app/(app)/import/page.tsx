import { PageShell } from "@/components/shell/PageShell";
import { ImportClient } from "./ImportClient";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  return (
    <PageShell
      page="import"
      title="Import data"
      subtitle="Upload bank or credit-card statements (CSV or XLSX)"
    >
      <ImportClient />
    </PageShell>
  );
}
