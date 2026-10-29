"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { betterAuthMessage } from "@/i18n/better-auth";
import { Button, Notice } from "@/components/ui";

type State = "idle" | "working" | "done" | "error";

export function PasskeyPrompt({ deviceHint }: { deviceHint: string }) {
  const router = useRouter();
  const t = useTranslations("auth.welcome.prompt");
  const library = useTranslations("problems.auth.betterAuth");
  const notice = useTranslations("auth.notice");
  const locale = useLocale();
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(
      typeof window !== "undefined" && !!window.PublicKeyCredential,
    );
  }, []);

  async function add() {
    setState("working");
    setMessage(null);

    const res = await authClient.passkey.addPasskey({ name: deviceHint });

    if (res?.error) {
      // A cancelled system prompt is a choice, not a failure — say so plainly.
      setState("error");
      // Better Auth's own sentence for an English reader, as before; its code
      // in the reader's language otherwise (src/i18n/better-auth.ts).
      setMessage(betterAuthMessage(res.error, { locale, t: library, fallback: t("failed") }));
      return;
    }
    setState("done");
  }

  if (!supported) {
    return (
      <div className="flex flex-col gap-[17.6px]">
        <Notice label={notice("note")}>{t("unsupported")}</Notice>
        <Button onClick={() => router.push("/")}>{t("takeMeIn")}</Button>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className="flex flex-col gap-[17.6px]">
        <Notice tone="good" label={notice("good")}>{t("done")}</Notice>
        <Button onClick={() => router.push("/")}>{t("takeMeIn")}</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[17.6px]">
      <Button onClick={add} disabled={state === "working"} className="w-full">
        {state === "working" ? t("working") : t("add")}
      </Button>

      {message && <Notice tone="warn" label={notice("holdOn")}>{message}</Notice>}

      {/* Honest about the consequence. The old copy said "Skip for now" and
          then never mentioned it again, which is how people ended up typing a
          password every time without ever choosing to. */}
      <button
        type="button"
        onClick={() => router.push("/")}
        className="cursor-pointer self-center text-[13.5px] font-bold text-ink-2 underline underline-offset-2 hover:text-cherry-dk"
      >
        {t("notNow")}
      </button>
    </div>
  );
}
