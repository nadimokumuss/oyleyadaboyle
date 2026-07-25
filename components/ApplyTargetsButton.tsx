"use client";

import { useState } from "react";
import { saveTargetsAction } from "@/app/actions/settings";
import { Button } from "@/components/form/Button";

/**
 * Önerilen dağılımı hedef olarak kaydeder.
 *
 * Kaydedildikten sonra Fırsatlar sayfasındaki `rebalance` kuralı bu
 * hedefleri takip etmeye başlar — öneri statik bir tablo olmaktan
 * çıkıp sürekli izlenen bir plana dönüşür.
 */
export function ApplyTargetsButton({
  targets,
}: {
  targets: Array<{ kind: string; pct: string }>;
}) {
  const [done, setDone] = useState(false);

  return (
    <form
      action={async (formData: FormData) => {
        await saveTargetsAction({}, formData);
        setDone(true);
      }}
    >
      {targets.map((t) => (
        <input
          key={t.kind}
          type="hidden"
          name={`target_${t.kind}`}
          value={t.pct}
        />
      ))}
      <input type="hidden" name="tolerance" value="0.05" />

      {done ? (
        <p className="text-sm text-gain">
          Hedefler kaydedildi — Fırsatlar sayfası artık sapmaları takip ediyor.
        </p>
      ) : (
        <Button type="submit" variant="primary">
          Bu dağılımı hedef olarak kaydet
        </Button>
      )}
    </form>
  );
}
