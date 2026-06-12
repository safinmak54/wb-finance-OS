import { TransactionsPage } from "@/components/transactions/TransactionsPage";

export const dynamic = "force-dynamic";

export default async function CcInboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <TransactionsPage
      side="cc"
      page="cc-inbox"
      title="Credit Card Transactions"
      searchParams={sp}
    />
  );
}
