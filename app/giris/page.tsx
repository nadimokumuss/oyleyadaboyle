import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { isAuthenticated } from "@/lib/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function GirisPage() {
  const state = getAuthState();
  if (!state.setupCompleted || !state.hasPin) redirect("/kurulum");
  if (await isAuthenticated()) redirect("/");

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <header className="mb-6 text-center">
          <h1 className="text-balance text-lg font-semibold text-ink">
            Servet Terminali
          </h1>
          <p className="mt-1 text-sm text-ink-muted">Devam etmek için PIN girin</p>
        </header>
        <LoginForm />
      </div>
    </div>
  );
}
