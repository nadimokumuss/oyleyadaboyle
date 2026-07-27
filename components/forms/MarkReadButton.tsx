"use client";

import { markNotificationsReadAction } from "@/app/actions/automation";
import { SubmitButton } from "@/components/form/Button";

export function MarkReadButton({ count }: { count: number }) {
  return (
    <form action={markNotificationsReadAction}>
      <SubmitButton>{count} bildirimi okundu işaretle</SubmitButton>
    </form>
  );
}
