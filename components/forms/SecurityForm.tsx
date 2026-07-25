"use client";

import { useActionState, useState } from "react";
import { saveSecurityAction } from "@/app/actions/settings";
import type { FormState } from "@/app/actions/assets";
import { Field, TextArea } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: FormState = {};

/**
 * IP kısıtlaması.
 *
 * Ev veya ofis IP'niz sabitse bu, paneli pratikte dünyanın geri
 * kalanından tamamen gizler — parola denemesi yapabilmek için bile
 * doğru ağdan bağlanmak gerekir.
 *
 * Kendinizi dışarıda bırakma riski gerçek, o yüzden mevcut IP'niz
 * gösteriliyor ve tek tıkla eklenebiliyor.
 */
export function SecurityForm({
  allowedIps,
  isPublic,
}: {
  allowedIps: string;
  isPublic: boolean;
}) {
  const [state, action] = useActionState(saveSecurityAction, initial);
  const [value, setValue] = useState(allowedIps);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}
      {state.savedId && !state.error && (
        <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
          Erişim ayarları kaydedildi.
        </p>
      )}

      {!isPublic && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-pretty text-xs text-ink-muted">
          Panel şu an yerel çalışıyor, IP kısıtlaması gerekmiyor. İnternete
          açtığınızda <code className="text-ink">SERVET_PUBLIC=1</code> ortam
          değişkeniyle sıkı mod devreye girer.
        </p>
      )}

      <Field
        label="İzin verilen IP adresleri"
        htmlFor="allowedIps"
        hint="Virgülle ayırın. CIDR yazılabilir (örn. 88.230.10.0/24). Boş bırakırsanız kısıtlama olmaz."
      >
        <TextArea
          id="allowedIps"
          name="allowedIps"
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="88.230.10.5, 192.168.1.0/24"
          className="num"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const res = await fetch("/api/whoami");
              const data = await res.json();
              setMyIp(data.ip ?? "bilinmiyor");
              if (data.ip && !value.includes(data.ip)) {
                setValue(value ? `${value}, ${data.ip}` : data.ip);
              }
            } catch {
              setMyIp("alınamadı");
            } finally {
              setLoading(false);
            }
          }}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {loading ? "Alınıyor…" : "Şu anki IP'mi ekle"}
        </button>
        {myIp && <span className="num text-xs text-ink-faint">Bağlantı: {myIp}</span>}
      </div>

      {value.trim() && (
        <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-pretty text-xs text-warn">
          Dikkat: listede olmayan bir ağdan bağlanırsanız panele giremezsiniz.
          IP&apos;niz değişkense (mobil bağlantı, dinamik IP) bu kısıtlamayı boş
          bırakmak daha güvenli. Kilitlenirseniz sunucudaki veritabanından
          <code className="mx-1 text-ink">allowed_ips</code> alanını temizlemeniz
          gerekir.
        </p>
      )}

      <SubmitButton variant="secondary">Erişim ayarlarını kaydet</SubmitButton>
    </form>
  );
}
