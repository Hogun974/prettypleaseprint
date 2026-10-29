import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { checkInviteToken } from "@/lib/invites";
import { AuthShell, H1, Kicker, Lead, Notice } from "@/components/ui";
import { ClaimForm } from "./claim-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const check = await checkInviteToken(decodeURIComponent(token));
  const [t, auth, shell] = await Promise.all([
    getTranslations("invite"),
    getTranslations("auth"),
    getTranslations("authShell"),
  ]);

  if (!check.ok) {
    // `check.reason` is one of `InviteRejection`, each with a title and a body
    // under `invite.rejected` — the typecheck holds the two lists together.
    return (
      <AuthShell sign={shell("sign")}>
        <Kicker>{t("kicker")}</Kicker>
        <H1>{t(`rejected.${check.reason}.title`)}</H1>
        <Lead>{t(`rejected.${check.reason}.body`)}</Lead>
        <Link
          href="/signin"
          className="font-bold text-[15px] text-cherry-dk underline underline-offset-2 hover:text-cherry"
        >
          {auth("goSignIn")}
        </Link>
      </AuthShell>
    );
  }

  const inviter = await db.user.findUnique({
    where: { id: check.invite.invitedById },
    select: { name: true },
  });

  return (
    <AuthShell sign={shell("sign")}>
      <Kicker>{t("kicker")}</Kicker>
      <H1>{t("title", { name: inviter?.name ?? t("someone") })}</H1>
      <Lead>
        {t.rich("lead", { mono: (chunks) => <span className="font-mono">{chunks}</span> })}
      </Lead>

      <ClaimForm
        token={decodeURIComponent(token)}
        email={check.invite.email}
        suggestedName={check.invite.name ?? ""}
      />

      <div className="mt-[22px]">
        <Notice label={auth("notice.note")}>{t("notice")}</Notice>
      </div>
    </AuthShell>
  );
}
