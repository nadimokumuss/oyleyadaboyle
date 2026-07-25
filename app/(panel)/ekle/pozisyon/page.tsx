import { PositionForm } from "@/components/forms/PositionForm";
import { loadAssetDefaults } from "@/lib/services/load";
import { listCashAccounts } from "@/lib/services/funding";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; symbol?: string; name?: string; kind?: string; status?: string }>;
}) {
  const params = await searchParams;
  const defaults = params.id
    ? loadAssetDefaults(params.id, "position")
    : {
        symbol: params.symbol,
        name: params.name,
        kind: params.kind,
        status: params.status,
      };

  return (
    <div className="px-6 py-6">
      <PositionForm defaults={defaults} cashAccounts={listCashAccounts()} />
    </div>
  );
}
