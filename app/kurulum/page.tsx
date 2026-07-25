import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { MIN_SECRET_LENGTH, isPublicDeployment } from "@/lib/security";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default function KurulumPage() {
  const state = getAuthState();
  if (state.setupCompleted && state.hasPin) redirect("/giris");

  return (
    <div className="flex min-h-dvh items-center justify-center overflow-y-auto p-6">
      <div className="w-full max-w-md py-8">
        <header className="mb-6">
          <h1 className="text-balance text-xl font-semibold text-ink">
            Servet Terminali kurulumu
          </h1>
          <p className="mt-1.5 text-pretty text-sm text-ink-muted">
            {isPublicDeployment
              ? "Bu panel internete açık çalışıyor. Güçlü bir parola seçin ve kurulumdan sonra ayarlardan iki faktörlü doğrulamayı açın."
              : "Tek seferlik birkaç ayar. Tüm veriniz bu bilgisayarda kalır; dışarı yalnızca anonim fiyat sorguları gider."}
          </p>
        </header>
        <SetupForm minLength={MIN_SECRET_LENGTH} />
      </div>
    </div>
  );
}
