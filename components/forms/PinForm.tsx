"use client";

import { useActionState } from "react";
import { changePinAction } from "@/app/actions/settings";
import type { FormState } from "@/app/actions/assets";
import { Field, TextInput } from "@/components/form/Field";
import { SubmitButton } from "@/components/form/Button";

const initial: FormState = {};

export function PinForm() {
  const [state, action] = useActionState(changePinAction, initial);
  const err = state.fieldErrors ?? {};

  return (
    <form action={action} className="space-y-4">
      {state.savedId && (
        <p className="rounded-md border border-gain/40 bg-gain/10 px-3 py-2 text-sm text-gain">
          PIN değiştirildi.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Mevcut PIN" htmlFor="currentPin" required error={err.currentPin}>
          <TextInput
            id="currentPin"
            name="currentPin"
            type="password"
            autoComplete="current-password"
            required
            error={err.currentPin}
          />
        </Field>

        <Field label="Yeni PIN" htmlFor="newPin" required error={err.newPin}>
          <TextInput
            id="newPin"
            name="newPin"
            type="password"
            autoComplete="new-password"
            required
            minLength={4}
            error={err.newPin}
          />
        </Field>

        <Field label="Yeni PIN tekrar" htmlFor="newPinConfirm" required error={err.newPinConfirm}>
          <TextInput
            id="newPinConfirm"
            name="newPinConfirm"
            type="password"
            autoComplete="new-password"
            required
            error={err.newPinConfirm}
          />
        </Field>
      </div>

      <SubmitButton variant="secondary">PIN'i değiştir</SubmitButton>
    </form>
  );
}
