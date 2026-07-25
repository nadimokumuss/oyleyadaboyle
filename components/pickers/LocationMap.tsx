"use client";

import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from "react-leaflet";
import { useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * Harita — sadece istemcide çalışır (Leaflet DOM'a ihtiyaç duyar),
 * bu yüzden LocationPicker içinden dinamik olarak yüklenir.
 *
 * Leaflet'in varsayılan işaretçi ikonu paket yollarını bundler'da
 * bulamıyor; bu yüzden CSS ile çizilmiş sade bir işaretçi kullanıyoruz.
 */

const pinIcon = L.divIcon({
  className: "",
  html: `<span style="
    display:block;width:18px;height:18px;border-radius:9999px;
    background:oklch(0.78 0.14 78);
    border:3px solid oklch(0.16 0.008 250);
    box-shadow:0 0 0 1px oklch(0.78 0.14 78);
  "></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Dışarıdan konum değişince haritayı oraya taşır. */
function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], Math.max(map.getZoom(), 11));
  }, [lat, lng, map]);
  return null;
}

export default function LocationMap({
  lat,
  lng,
  onPick,
}: {
  lat: number;
  lng: number;
  onPick: (lat: number, lng: number) => void;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={11}
      scrollWheelZoom={false}
      className="h-64 w-full rounded-md"
      style={{ background: "oklch(0.2 0.009 250)" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> katkıda bulunanlar'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker
        position={[lat, lng]}
        icon={pinIcon}
        draggable
        eventHandlers={{
          dragend(e) {
            const p = (e.target as L.Marker).getLatLng();
            onPick(p.lat, p.lng);
          },
        }}
      />
      <ClickHandler onPick={onPick} />
      <Recenter lat={lat} lng={lng} />
    </MapContainer>
  );
}
