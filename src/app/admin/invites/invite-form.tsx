"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

import { sendInviteAction, type InviteFormState } from "./actions";
import { Button, Input, Label, Notice } from "@/components/ui";
import { HandoverLink, type HandoverLabels } from "@/components/handover-link";

/**
 * Its words come from the server page that draws it (admin.guests), as
 * props: owner-only words stay out of the client catalogue that every page
 * carries (src/i18n/client-groups.ts).
 */
export type InviteFormLabels = {
  title: string;
  lead: string;
  email: string;
  name: string;
  send: string;
  sending: string;
  holdOn: string;
  handover: HandoverLabels;
};

function Submit({ labels }: { labels: InviteFormLabels }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? labels.sending : labels.send}
    </Button>
  );
}

export function InviteForm({ labels }: { labels: InviteFormLabels }) {
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
        {labels.title}
      </h2>
      <p className="m-0 mb-[17.6px] text-[14.5px] text-ink-2">{labels.lead}</p>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[17.6px]">
        <div>
          <Label htmlFor="invite-email">{labels.email}</Label>
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
          <Label htmlFor="invite-name">{labels.name}</Label>
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
        <Submit labels={labels} />
        {state.sent && !state.handoverUrl && (
          <span className="rounded-chip border-2 border-ink bg-mint px-[11px] py-[3px] font-mono text-[11.5px] font-bold uppercase text-ink">
            {state.notice}
          </span>
        )}
        {state.sent && state.handoverUrl && (
          <span className="rounded-chip border-2 border-ink bg-sun px-[11px] py-[3px] font-mono text-[11.5px] font-bold uppercase text-ink">
            {state.notice}
          </span>
        )}
      </div>

      {state.handoverUrl && (
        <HandoverLink url={state.handoverUrl} labels={labels.handover} />
      )}

      {state.error && (
        <div className="mt-[13.2px]">
          <Notice tone="warn" label={labels.holdOn}>{state.error}</Notice>
        </div>
      )}
    </form>
  );
}
