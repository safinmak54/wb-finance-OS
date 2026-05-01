import { PageShell } from "@/components/shell/PageShell";
import { createDataClient } from "@/lib/supabase/data";
import { fetchReportData, groupByAccount } from "@/lib/queries/reports";
import { entityFilterFromSearchParams } from "@/lib/entity-filter";
import { periodFromSearchParams } from "@/lib/period";
import { ProductMixClient } from "./ProductMixClient";

export const dynamic = "force-dynamic";

export default async function ProductMixPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const period = periodFromSearchParams(sp);
  const entity = entityFilterFromSearchParams(sp);

  const supabase = createDataClient();
  const data = await fetchReportData(supabase, {
    entity,
    from: period.from,
    to: period.to,
  });
  const groups = groupByAccount(data.txns);

  const revenueByChannel = groups
    .filter((g) => g.account?.account_type === "revenue")
    .map((g) => ({
      label: g.account?.account_name ?? "—",
      amount: g.total,
    }));

  const adSpend = groups
    .filter(
      (g) =>
        g.account?.account_type === "expense" &&
        g.account.account_subtype === "advertising",
    )
    .map((g) => ({
      label: g.account?.account_name ?? "—",
      amount: -g.total,
    }));

  const totalRevenue = revenueByChannel.reduce((s, r) => s + r.amount, 0);
  const totalAd = adSpend.reduce((s, r) => s + r.amount, 0);
  const roas = totalAd > 0 ? totalRevenue / totalAd : 0;

  return (
    <PageShell
      page="productmix"
      title="Product Mix"
      subtitle={`${period.label} · ${entity === "all" ? "All entities" : entity}`}
    >
      <ProductMixClient
        revenueByChannel={revenueByChannel}
        adSpend={adSpend}
        totalRevenue={totalRevenue}
        totalAd={totalAd}
        roas={roas}
      />
    </PageShell>
  );
}
