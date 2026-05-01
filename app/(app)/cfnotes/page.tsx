import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { listCfoNotes } from "@/lib/queries/notes";
import { CfNotesClient } from "./CfNotesClient";

export const dynamic = "force-dynamic";

export default async function CfNotesPage() {
  const supabase = createDataClient();
  const notes = await listCfoNotes(supabase);

  return (
    <PageShell
      page="cfnotes"
      title="CFO Notes"
      subtitle={`${notes.length} ${notes.length === 1 ? "note" : "notes"}`}
    >
      <CfNotesClient notes={notes} />
    </PageShell>
  );
}
