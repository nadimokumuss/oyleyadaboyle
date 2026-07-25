import { DepositForm } from "@/components/forms/DepositForm";
import { loadAssetDefaults } from "@/lib/services/load";
import { listCashAccounts } from "@/lib/services/funding";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const defaults = id ? loadAssetDefaults(id, "deposit") : {};

  return (
    <div className="px-6 py-6">
      <DepositForm defaults={defaults} cashAccounts={listCashAccounts()} />
    </div>
  );
}
