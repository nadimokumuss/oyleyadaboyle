import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  verifySessionToken,
  getAuthState,
} from "./auth";

/**
 * Sunucu tarafı oturum kapısı.
 *
 * Doğrulama Node çalışma zamanında yapılır (middleware'in Edge ortamında
 * `node:crypto` ve SQLite kullanılamaz). Korunan her sayfa ve her yazma
 * işlemi buradan geçer — tek bir yerde toplandığı için bir sayfayı
 * korumayı unutmak zorlaşır.
 */

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Oturum yoksa uygun sayfaya yönlendirir.
 * Kurulum yapılmamışsa /kurulum, yapılmışsa /giris.
 */
export async function requireAuth(): Promise<void> {
  const { setupCompleted, hasPin } = getAuthState();

  if (!setupCompleted || !hasPin) {
    redirect("/kurulum");
  }
  if (!(await isAuthenticated())) {
    redirect("/giris");
  }
}

/**
 * Server Action ve API uçları için: yetki yoksa hata fırlatır.
 * Yönlendirme yerine hata, çünkü bir yazma işleminin sessizce
 * yönlendirilip "başarılı" görünmesi tehlikeli olurdu.
 */
export async function assertAuth(): Promise<void> {
  const { setupCompleted, hasPin } = getAuthState();
  if (!setupCompleted || !hasPin) {
    throw new Error("Kurulum tamamlanmamış");
  }
  if (!(await isAuthenticated())) {
    throw new Error("Oturum geçersiz — lütfen tekrar giriş yapın");
  }
}
