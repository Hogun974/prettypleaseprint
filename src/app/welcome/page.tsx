import { headers } from "next/headers";
import { requireUser } from "@/lib/authz";
import { deviceLabel } from "@/lib/device-label";
import { AuthShell, H1, Kicker, Lead } from "@/components/ui";
import { PasskeyPrompt } from "./passkey-prompt";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await requireUser("/welcome");
  const ua = (await headers()).get("user-agent");

  return (
    <AuthShell>
      <Kicker>You&rsquo;re in</Kicker>
      <H1>Welcome, {user.name.split(" ")[0]}</H1>
      <Lead>
        One last thing worth thirty seconds: save a passkey. It puts your
        fingerprint, face or device PIN where the password goes, and unlike a
        password there is nothing to phish, reuse or forget.
      </Lead>
      <PasskeyPrompt deviceHint={deviceLabel(ua)} />
    </AuthShell>
  );
}
