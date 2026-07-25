import { VentureForm } from "@/components/forms/VentureForm";
import { loadAssetDefaults } from "@/lib/services/load";
import { listCashAccounts } from "@/lib/services/funding";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; status?: string }>;
}) {
  const params = await searchParams;
  const defaults = params.id
    ? loadAssetDefaults(params.id, "venture")
    : { status: params.status };

  return (
    <div className="px-6 py-6">
      <VentureForm defaults={defaults} cashAccounts={listCashAccounts()} />
    </div>
  );
}
