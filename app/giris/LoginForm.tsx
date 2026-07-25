"use client";

import { useActionState } from "react";
import { login, type ActionState } from "@/app/actions/auth";
import { Field, TextInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: ActionState = {};

export function LoginForm() {
  const [state, action] = useActionState(login, initial);

  return (
    <form action={action} className="rounded-lg border border-line bg-surface-raised p-6">
      {state.error && (
        <p className="mb-4 rounded-md border border-loss/40 bg-loss/10 px-3 py-2 text-pretty text-sm text-loss">
          {state.error}
        </p>
      )}

      <Field label="PIN" htmlFor="pin" error={state.fieldErrors?.pin}>
        <TextInput
          id="pin"
          name="pin"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          error={state.fieldErrors?.pin}
        />
      </Field>

      <SubmitButton className="mt-4 w-full" pendingText="Kontrol ediliyor…">
        Giriş yap
      </SubmitButton>
    </form>
  );
}
