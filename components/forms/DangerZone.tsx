"use client";

import { useActionState, useState } from "react";
import {
  clearAllDataAction, importCsvAction, type ImportState,
} from "@/app/actions/settings";
import { Button, SubmitButton } from "@/components/form/Button";
import { TextInput } from "@/components/form/Field";

const importInitial: ImportState = {};

function ImportForm() {
  const [state, action] = useActionState(importCsvAction, importInitial);

  return (
    <form action={action} className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="max-w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-surface-hover"
        />
        <SubmitButton variant="secondary" pendingText="Yükleniyor…">
          İçe aktar
        </SubmitButton>
      </div>

      {state.error && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error}
        </p>
      )}

      {state.imported !== undefined && (
        <div
          className={
            "rounded-md border px-3 py-2 " +
            (state.skipped && state.skipped.length > 0
              ? "border-warn/40 bg-warn/10"
              : "border-gain/40 bg-gain/10")
          }
        >
          <p className="num text-sm text-ink">
            {state.total} satırdan{" "}
            <strong className="text-gain">{state.imported}</strong> tanesi
            yüklendi
            {state.skipped && state.skipped.length > 0 && (
              <>
                , <strong className="text-warn">{state.skipped.length}</strong>{" "}
                tanesi atlandı
              </>
            )}
            .
          </p>
          {state.skipped && state.skipped.length > 0 && (
            <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
              {state.skipped.slice(0, 20).map((s, i) => (
                <li key={i} className="num text-pretty text-xs text-ink-muted">
                  Satır {s.line}: {s.reason}
                </li>
              ))}
              {state.skipped.length > 20 && (
                <li className="text-xs text-ink-faint">
                  …ve {state.skipped.length - 20} satır daha
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * Veri yönetimi.
 *
 * Silme işlemi geri alınamaz olduğu için "SİL" yazma onayı isteniyor —
 * yanlışlıkla tıklanabilecek tek bir düğme, tüm servet kaydını
 * silmek için fazla ucuz bir hareket olurdu.
 */
export function DangerZone() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-ink">Dışa aktarım</p>
        <p className="mt-1 text-pretty text-xs text-ink-muted">
          Verilerinizi Excel'de açılabilir CSV olarak indirin.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { type: "positions", label: "Varlıklar" },
            { type: "transactions", label: "İşlemler" },
            { type: "snapshots", label: "Servet geçmişi" },
          ].map((x) => (
            <a
              key={x.type}
              href={`/api/export?type=${x.type}`}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {x.label} CSV
            </a>
          ))}
        </div>
      </div>

      <div className="border-t border-line pt-4">
        <p className="text-sm font-medium text-ink">İçe aktarım</p>
        <p className="mt-1 text-pretty text-xs text-ink-muted">
          Panelden dışa aktardığınız varlık CSV&apos;sini geri yükleyin. Nakit ve
          piyasa pozisyonları alınır; mevduat, gayrimenkul ve girişim için
          CSV&apos;de yeterli alan olmadığından bunları formdan eklemeniz gerekir.
        </p>
        <ImportForm />
      </div>

      <div className="border-t border-line pt-4">
        <p className="text-sm font-medium text-ink">Yedekleme</p>
        <p className="mt-1 text-pretty text-xs text-ink-muted">
          Veritabanı tek bir dosya. Yedeklemek için kopyalamak yeterli:
        </p>
        <code className="mt-2 block overflow-x-auto rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-muted">
          cp data/servet.db &quot;yedek-$(date +%F).db&quot;
        </code>
      </div>

      <div className="border-t border-line pt-4">
        <p className="text-sm font-medium text-loss">Tüm verileri sil</p>
        <p className="mt-1 text-pretty text-xs text-ink-muted">
          Tüm varlıklar, işlemler ve hedefler silinir. Ayarlarınız ve PIN'iniz
          korunur. <strong className="text-loss">Bu işlem geri alınamaz.</strong>
        </p>

        {!open ? (
          <Button
            type="button"
            variant="ghost"
            className="mt-2"
            onClick={() => setOpen(true)}
          >
            Silme seçeneğini göster
          </Button>
        ) : (
          <form action={clearAllDataAction} className="mt-3 space-y-2">
            <label htmlFor="confirm" className="block text-xs text-ink-muted">
              Onaylamak için kutuya <strong className="text-ink">SİL</strong> yazın:
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                id="confirm"
                name="confirm"
                required
                pattern="SİL"
                autoComplete="off"
                className="max-w-32"
              />
              <Button type="submit" variant="danger">
                Kalıcı olarak sil
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Vazgeç
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
