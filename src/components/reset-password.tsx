"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { resetPasswordAction, type InviteFormState } from "@/app/admin/invites/actions";
import { HandoverLink, type HandoverLabels } from "@/components/handover-link";
import { Notice } from "@/components/ui";

/**
 * Its words come from the server page that draws it (admin.guests), as
 * props: owner-only words stay out of the client catalogue that every page
 * carries (src/i18n/client-groups.ts).
 */
export type ResetPasswordLabels = {
  summary: string;
  help: string;
  submit: string;
  working: string;
  good: string;
  holdOn: string;
  handover: HandoverLabels;
};

function Submit({ labels }: { labels: ResetPasswordLabels }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-porcelain px-[15px] py-[6px] font-mono text-[11.5px] font-bold uppercase text-ink hover:bg-sun disabled:opacity-50"
    >
      {pending ? labels.working : labels.submit}
    </button>
  );
}

/**
 * "I have forgotten my password", and "I wiped my phone and the passkey went
 * with it."
 *
 * Sits behind a disclosure because it is not an everyday action. Unlike the
 * sign-in link it replaces, the link this mints does not sign anybody in — it
 * lets them choose a new password, which they then have to use. An admin who
 * keeps the link for themselves would be locking the member out rather than
 * quietly becoming them, and the audit trail names them either way.
 */
export function ResetPassword({
  userId,
  labels,
}: {
  userId: string;
  labels: ResetPasswordLabels;
}) {
  const [state, formAction] = useActionState<InviteFormState, FormData>(
    resetPasswordAction,
    {},
  );

  return (
    <details>
      {/* Neutral rather than red. This mints a recovery link — it takes
          nothing away — and the guest list draws one of these per member, so a
          row of red buttons would shout about the wrong thing. The weight sits
          on the confirm inside, where it belongs. */}
      <summary className="stamp inline-block cursor-pointer list-none rounded-chip border-[3px] border-ink bg-porcelain px-[15px] py-[8px] text-[14px] font-bold text-ink hover:bg-sun">
        {labels.summary}
      </summary>
      <form action={formAction} className="mt-[8px] max-w-[560px]">
        <input type="hidden" name="userId" value={userId} />
        <div className="rounded-card border-[3px] border-ink bg-cream-2 p-[11px]">
          <p className="m-0 mb-[8px] text-[13.5px] leading-[1.45] text-ink-2">
            {labels.help}
          </p>
          <Submit labels={labels} />
        </div>
        {state.sent && !state.handoverUrl && (
          <div className="mt-[8px]">
            <Notice tone="good" label={labels.good}>
              {state.notice}
            </Notice>
          </div>
        )}
        {state.handoverUrl && (
          <HandoverLink
            url={state.handoverUrl}
            labels={labels.handover}
          />
        )}
        {state.error && (
          <div className="mt-[8px]">
            <Notice tone="warn" label={labels.holdOn}>{state.error}</Notice>
          </div>
        )}
      </form>
    </details>
  );
}
