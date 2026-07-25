"use client";

import { useActionState } from "react";
import { login, type ActionState } from "@/app/actions/auth";
import { Field, TextInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: ActionState = {};

export function LoginForm() {
  const [state, action] = useActionState(login, initial);
  const needsCode = state.needsSecondFactor;

  return (
    <form action={action} className="rounded-lg border border-line bg-surface-raised p-6">
      {state.error && (
        <p
          role="alert"
          className="mb-4 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-pretty text-sm text-loss"
        >
          {state.error}
        </p>
      )}

      <Field
        label="Parola"
        htmlFor="pin"
        error={state.fieldErrors?.pin}
      >
        <TextInput
          id="pin"
          name="pin"
          type="password"
          autoComplete="current-password"
          autoFocus={!needsCode}
          required
          error={state.fieldErrors?.pin}
        />
      </Field>

      {needsCode && (
        <div className="mt-4">
          <p className="mb-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-pretty text-xs text-ink-muted">
            Parola doğru. Kimlik doğrulama uygulamanızdaki 6 haneli kodu girin.
            Telefonunuza erişemiyorsanız kurtarma kodlarınızdan birini
            kullanabilirsiniz.
          </p>
          <Field
            label="Doğrulama kodu"
            htmlFor="code"
            error={state.fieldErrors?.code}
          >
            <TextInput
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              maxLength={9}
              error={state.fieldErrors?.code}
              className="num text-center text-lg tracking-widest"
            />
          </Field>
        </div>
      )}

      <SubmitButton className="mt-4 w-full" pendingText="Kontrol ediliyor…">
        {needsCode ? "Doğrula ve gir" : "Giriş yap"}
      </SubmitButton>
    </form>
  );
}
