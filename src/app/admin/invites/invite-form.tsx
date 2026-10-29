"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import { sendInviteAction, type InviteFormState } from "./actions";
import { Button, Input, Label, Notice } from "@/components/ui";
import { HandoverLink } from "@/components/handover-link";

function Submit() {
  const t = useTranslations("admin.guests");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? t("sending") : t("send")}
    </Button>
  );
}

export function InviteForm() {
  const t = useTranslations("admin.guests");
  const [state, formAction] = useActionState<InviteFormState, FormData>(
    sendInviteAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.sent) formRef.current?.reset();
  }, [state.sent]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="rounded-panel border-[3px] border-ink bg-aqua-wash p-[22px] shadow-stamp"
    >
      <h2 className="m-0 mb-[4px] font-display text-[22px] text-ink">
        {t("inviteTitle")}
      </h2>
      <p className="m-0 mb-[17.6px] text-[14.5px] text-ink-2">{t("inviteLead")}</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[17.6px]">
        <div>
          <Label htmlFor="invite-email">{t("email")}</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            placeholder="ayla@office.example"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="invite-name">{t("name")}</Label>
          <Input
            id="invite-name"
            name="name"
            maxLength={80}
            placeholder="Ayla Berg"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-[17.6px] flex flex-wrap items-center gap-[13.2px]">
        <Submit />
        {state.sent && !state.handoverUrl && (
          <span className="rounded-chip border-2 border-ink bg-mint px-[11px] py-[3px] font-mono text-[11.5px] font-bold uppercase text-ink">
            {t("emailed", { email: state.sent })}
          </span>
        )}
        {state.sent && state.handoverUrl && (
          <span className="rounded-chip border-2 border-ink bg-sun px-[11px] py-[3px] font-mono text-[11.5px] font-bold uppercase text-ink">
            {t("created", { email: state.sent })}
          </span>
        )}
      </div>

      {state.handoverUrl && (
        <HandoverLink url={state.handoverUrl} note={t("inviteNote")} />
      )}

      {state.error && (
        <div className="mt-[13.2px]">
          <Notice tone="warn" label={t("holdOn")}>{state.error}</Notice>
        </div>
      )}
    </form>
  );
}
