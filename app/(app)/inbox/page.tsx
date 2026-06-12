import { TransactionsPage } from "@/components/transactions/TransactionsPage";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <TransactionsPage
      side="bank"
      page="inbox"
      title="Bank Transactions"
      searchParams={sp}
    />
  );
}
