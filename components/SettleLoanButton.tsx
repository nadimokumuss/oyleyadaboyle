"use client";

import { useState } from "react";
import { settleLoanAction } from "@/app/actions/dispose";
import { Button } from "@/components/form/Button";

/**
 * Krediyi erken kapatır.
 *
 * Nakit çıkışı otomatik yazılmaz — kapatma parasının nereden geldiği
 * kullanıcıya bağlı (birikim, başka varlık satışı, gelir). Panel bunu
 * tahmin etmek yerine söylüyor ve nakit hareketini kullanıcının
 * girmesini bekliyor.
 */
export function SettleLoanButton({ id, name }: { id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
        Krediyi kapat
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-pretty text-xs text-ink-muted">
        <strong className="text-ink">{name}</strong> kapatılmış sayılacak ve net
        servetinizden borç düşülmesi sona erecek. Kapatma için ödediğiniz parayı
        ayrıca nakit hesabınızdan düşmeniz gerekir — panel bu paranın nereden
        geldiğini bilemez.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <form action={settleLoanAction}>
          <input type="hidden" name="id" value={id} />
          <Button type="submit" variant="primary">
            Kapatıldı olarak işaretle
          </Button>
        </form>
        <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
