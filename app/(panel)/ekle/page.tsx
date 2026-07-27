import Link from "next/link";
import { PageShell } from "@/components/PageShell";

export const dynamic = "force-dynamic";

const TYPES = [
  {
    href: "/ekle/nakit",
    title: "Nakit",
    desc: "Banka hesabınızdaki veya elinizdeki serbest para. Genelde buradan başlanır.",
  },
  {
    href: "/ekle/pozisyon",
    title: "Hisse / Kripto / ETF",
    desc: "Sembolü arayın, miktar ve alış fiyatını girin. Değer canlı fiyattan hesaplanır.",
  },
  {
    href: "/ekle/mevduat",
    title: "Mevduat",
    desc: "Vadeli veya vadesiz. Faiz kazancı saniye saniye akar.",
  },
  {
    href: "/ekle/gayrimenkul",
    title: "Gayrimenkul",
    desc: "Haritadan konum seçin. Değer bölgesel konut endeksiyle modellenir.",
  },
  {
    href: "/ekle/arac",
    title: "Araç",
    desc: "Marka, model ve yıl. Amortisman eğrisiyle değer kaybı hesaplanır.",
  },
  {
    href: "/ekle/tahvil",
    title: "Tahvil / Bono",
    desc: "Nominal, kupon ve vade. İşlemiş faiz ve vadeye kadar getiri hesaplanır.",
  },
  {
    href: "/ekle/emeklilik",
    title: "Emeklilik (BES)",
    desc: "Devlet katkısının ne kadarını hak ettiğiniz kademe kademe takip edilir.",
  },
  {
    href: "/ekle/kiymetli-esya",
    title: "Kıymetli eşya",
    desc: "Sanat, saat, mücevher. Canlı fiyat yoktur — değeri siz girersiniz.",
  },
  {
    href: "/ekle/girisim",
    title: "Girişim",
    desc: "Sahiplik payı, sermaye ve aylık gelir-gider. Runway takibi yapılır.",
  },
] as const;

export default function EklePage() {
  return (
    <PageShell
      title="Varlık ekle"
      subtitle="Ne eklemek istediğinizi seçin. Sahip olduklarınızı da, almayı planladıklarınızı da girebilirsiniz."
    >
      <ul className="grid gap-3 sm:grid-cols-2">
        {TYPES.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="block h-full rounded-lg border border-line bg-surface-raised p-4 transition-colors hover:border-accent/50 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <p className="text-sm font-medium text-ink">{t.title}</p>
              <p className="mt-1 text-pretty text-xs text-ink-muted">{t.desc}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
