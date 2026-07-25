import { CashForm } from "@/components/forms/CashForm";
import { loadAssetDefaults } from "@/lib/services/load";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const defaults = id ? loadAssetDefaults(id, "cash") : {};

  return (
    <div className="px-6 py-6">
      <CashForm defaults={defaults} />
    </div>
  );
}
