import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/authz";
import { deviceLabel } from "@/lib/device-label";
import { AuthShell, H1, Kicker, Lead } from "@/components/ui";
import { PasskeyPrompt } from "./passkey-prompt";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await requireUser("/welcome");
  const ua = (await headers()).get("user-agent");
  const [t, shell] = await Promise.all([
    getTranslations("auth.welcome"),
    getTranslations("authShell"),
  ]);

  return (
    <AuthShell sign={shell("sign")}>
      <Kicker>{t("kicker")}</Kicker>
      <H1>{t("title", { name: user.name.split(" ")[0]! })}</H1>
      <Lead>{t("lead")}</Lead>
      <PasskeyPrompt deviceHint={deviceLabel(ua)} />
    </AuthShell>
  );
}
