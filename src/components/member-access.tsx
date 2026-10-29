"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";

import { setMemberAccessAction, type InviteFormState } from "@/app/admin/invites/actions";
import { Notice } from "@/components/ui";

function Submit({ revoke, name }: { revoke: boolean; name: string }) {
  const t = useTranslations("admin.guests");
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        revoke
          ? "stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-wash px-[15px] py-[6px] font-mono text-[11.5px] font-bold uppercase text-cherry-dk hover:bg-cherry hover:text-cream disabled:opacity-50"
          : "stamp cursor-pointer rounded-chip border-[3px] border-ink bg-mint px-[15px] py-[6px] font-mono text-[11.5px] font-bold uppercase text-ink hover:bg-aqua disabled:opacity-50"
      }
    >
      {pending ? t("working") : revoke ? t("revokeName", { name }) : t("restoreName", { name })}
    </button>
  );
}

/**
 * "They have left, and should not be able to get back in."
 *
 * Suspension, not deletion: their tickets, comments and audit trail stay
 * exactly where they are. Behind a disclosure because it is not an everyday
 * action, and it takes effect the moment it is pressed — including on the
 * session they are using right now.
 */
export function MemberAccess({
  userId,
  name,
  suspended,
}: {
  userId: string;
  name: string;
  suspended: boolean;
}) {
  const t = useTranslations("admin.guests");
  const [state, formAction] = useActionState<InviteFormState, FormData>(
    setMemberAccessAction,
    {},
  );

  return (
    <details>
      {/* Two states, and they want opposite colours. "Revoke access?" locks a
          colleague out, so it carries the same cherry as the other destructive
          controls. "Suspended" is doing double duty — it reports a state and it
          is the way back — and red would read as a threat rather than a flag,
          so it takes the amber the tokens reserve for warnings. Both are
          buttons either way; neither used to look like one. */}
      <summary
        className={
          suspended
            ? "stamp inline-block cursor-pointer list-none rounded-chip border-[3px] border-ink bg-sun-wash px-[15px] py-[8px] text-[14px] font-bold text-sun-dk hover:bg-sun hover:text-ink"
            : "stamp inline-block cursor-pointer list-none rounded-chip border-[3px] border-ink bg-cherry-wash px-[15px] py-[8px] text-[14px] font-bold text-cherry-dk hover:bg-cherry-dk hover:text-cream"
        }
      >
        {suspended ? t("suspended") : t("revokeAccess")}
      </summary>
      <form action={formAction} className="mt-[8px] max-w-[560px]">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="revoke" value={suspended ? "false" : "true"} />
        <div className="rounded-card border-[3px] border-ink bg-cream-2 p-[11px]">
          <p className="m-0 mb-[8px] text-[13.5px] leading-[1.45] text-ink-2">
            {suspended ? t("suspendedHelp", { name }) : t("revokeHelp", { name })}
          </p>
          <Submit revoke={!suspended} name={name} />
        </div>
        {state.error && (
          <div className="mt-[8px]">
            <Notice tone="warn" label={t("holdOn")}>{state.error}</Notice>
          </div>
        )}
      </form>
    </details>
  );
}
