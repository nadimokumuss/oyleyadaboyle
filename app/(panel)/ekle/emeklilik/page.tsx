import { PensionForm } from "@/components/forms/PensionForm";
import { loadAssetDefaults } from "@/lib/services/load";

export const dynamic = "force-dynamic";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const params = await searchParams;
  const defaults = params.id ? loadAssetDefaults(params.id, "pension") : {};

  return (
    <div className="px-4 py-6 sm:px-6">
      <PensionForm defaults={defaults} />
    </div>
  );
}
