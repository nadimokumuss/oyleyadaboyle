/**
 * Panel yükleme iskeleti.
 *
 * Sayfalar `force-dynamic` ve sunucuda canlı fiyat çekiyor; sağlayıcı yavaşsa
 * gezinme anında yanıt vermeli, içerik sonra gelmeli. Bu dosya olmadan
 * tarayıcı eski sayfada donuyordu.
 */
export default function PanelLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6" aria-busy="true">
      <span className="sr-only" role="status">
        Sayfa yükleniyor
      </span>

      <div className="mb-6 space-y-2">
        <div className="h-6 w-52 animate-pulse rounded bg-surface-hover" />
        <div className="h-4 w-72 animate-pulse rounded bg-surface-hover" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-lg border border-line bg-surface-raised"
          />
        ))}
      </div>

      <div className="mt-3 h-64 animate-pulse rounded-lg border border-line bg-surface-raised" />
    </div>
  );
}
