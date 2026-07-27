import { BondForm } from "@/components/forms/BondForm";
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
    ? loadAssetDefaults(params.id, "bond")
    : { status: params.status };

  return (
    <div className="px-4 py-6 sm:px-6">
      <BondForm defaults={defaults} cashAccounts={listCashAccounts()} />
    </div>
  );
}
