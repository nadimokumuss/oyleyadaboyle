"use client";

import { useActionState, useState, useEffect } from "react";
import {
  beginTotpSetup, confirmTotpSetup, disableTotpAction,
  type TotpSetupState,
} from "@/app/actions/auth";
import { Button, SubmitButton } from "@/components/form/Button";
import { Field, TextInput } from "@/components/form/Field";

const initial: TotpSetupState = {};

/**
 * İki faktörlü doğrulama kurulumu.
 *
 * Akış bilinçli olarak "önce doğrula, sonra aç" şeklinde: kullanıcı
 * uygulamayı yanlış kurmuşsa ve biz 2FA'yı hemen açsaydık, kendi
 * panelinden kalıcı olarak kilitlenirdi. Kurtarma kodları da bu
 * yüzden var ve yalnızca bir kez gösteriliyor.
 */
export function TotpForm({
  enabled,
  remainingCodes,
}: {
  enabled: boolean;
  remainingCodes: number;
}) {
  const [setup, setSetup] = useState<TotpSetupState | null>(null);
  const [state, action] = useActionState(confirmTotpSetup, initial);

  // Onaylandıktan sonra kurtarma kodlarını göster
  const codes = state.recoveryCodes;

  if (codes) {
    return <RecoveryCodes codes={codes} />;
  }

  if (enabled) {
    return <EnabledPanel remainingCodes={remainingCodes} />;
  }

  if (!setup) {
    return (
      <div>
        <p className="text-pretty text-sm text-ink-muted">
          İki faktörlü doğrulama kapalı. Panel internete açıksa parolanızı ele
          geçiren biri doğrudan girebilir — ikinci faktör bunu engeller.
        </p>
        <Button
          type="button"
          variant="primary"
          className="mt-3"
          onClick={async () => setSetup(await beginTotpSetup())}
        >
          İki faktörlü doğrulamayı kur
        </Button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="secret" value={setup.secret ?? ""} />

      {(state.error ?? setup.error) && (
        <p className="rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">
          {state.error ?? setup.error}
        </p>
      )}

      <ol className="space-y-3 text-sm text-ink-muted">
        <li>
          <strong className="text-ink">1.</strong> Telefonunuzda bir kimlik
          doğrulama uygulaması açın (Google Authenticator, 1Password, Authy…).
        </li>
        <li>
          <strong className="text-ink">2.</strong> Aşağıdaki kodu okutun veya
          anahtarı elle girin.
        </li>
      </ol>

      {setup.otpauth && <QrCode value={setup.otpauth} />}

      <div>
        <p className="text-xs text-ink-faint">Elle girmek için anahtar:</p>
        <code className="num mt-1 block break-all rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
          {setup.secret}
        </code>
      </div>

      <Field
        label="Uygulamadaki 6 haneli kodu girin"
        htmlFor="totp-code"
        required
        hint="Doğrulanmadan 2FA açılmaz — yanlış kurulumla kendinizi kilitlemeyin."
      >
        <TextInput
          id="totp-code"
          name="code"
          inputMode="numeric"
          maxLength={6}
          required
          autoComplete="one-time-code"
          placeholder="123456"
          className="num text-center text-lg tracking-widest"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingText="Doğrulanıyor…">Doğrula ve aç</SubmitButton>
        <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

/** QR kodu istemcide üretilir — gizli anahtar sunucu günlüklerine düşmesin. */
function QrCode({ value }: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((QR) =>
        QR.toDataURL(value, {
          width: 220,
          margin: 1,
          color: { dark: "#0b0b0b", light: "#ffffff" },
        }),
      )
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        /* QR üretilemezse elle giriş anahtarı zaten gösteriliyor */
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!dataUrl) {
    return <div className="size-[220px] animate-pulse rounded-md bg-surface-hover" />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt="İki faktörlü doğrulama QR kodu"
      width={220}
      height={220}
      className="rounded-md border border-line bg-white p-2"
    />
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-md border border-gain/50 bg-gain/10 p-4">
      <p className="text-sm font-medium text-gain">
        İki faktörlü doğrulama açıldı.
      </p>
      <p className="mt-2 text-pretty text-sm text-ink">
        Bu kurtarma kodlarını güvenli bir yere kaydedin.{" "}
        <strong>Bir daha gösterilmeyecek.</strong> Telefonunuzu kaybederseniz
        panele yalnızca bunlarla girebilirsiniz. Her kod bir kez kullanılır.
      </p>

      <ul className="num mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {codes.map((c) => (
          <li
            key={c}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-center text-sm text-ink"
          >
            {c}
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="secondary"
        className="mt-3"
        onClick={() => {
          navigator.clipboard.writeText(codes.join("\n"));
          setCopied(true);
        }}
      >
        {copied ? "Kopyalandı" : "Kodları kopyala"}
      </Button>
    </div>
  );
}

function EnabledPanel({ remainingCodes }: { remainingCodes: number }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div>
      <p className="text-sm text-gain">İki faktörlü doğrulama açık.</p>
      <p className="mt-1 text-pretty text-xs text-ink-muted">
        {remainingCodes} kurtarma kodunuz kaldı.
        {remainingCodes <= 2 &&
          " Azaldı — 2FA'yı kapatıp yeniden kurarak yeni kodlar üretebilirsiniz."}
      </p>

      {!confirming ? (
        <Button
          type="button"
          variant="ghost"
          className="mt-3"
          onClick={() => setConfirming(true)}
        >
          Kapat
        </Button>
      ) : (
        <form action={disableTotpAction} className="mt-3 space-y-2">
          <p className="text-pretty text-xs text-warn">
            2FA kapatılırsa panele yalnızca parolayla girilir. Onaylamak için
            parolanızı girin.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              name="pin"
              type="password"
              required
              autoComplete="current-password"
              placeholder="Parola"
              className="max-w-48"
            />
            <Button type="submit" variant="danger">
              2FA&apos;yı kapat
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
