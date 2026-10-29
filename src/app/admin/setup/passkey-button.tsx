"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { authClient } from "@/lib/auth-client";
import { Button, Notice } from "@/components/ui";

type State = "idle" | "working" | "done" | "error";

/**
 * Save a passkey from the first step of the setup: the same call the
 * welcome screen's prompt makes, which is where the header's nudge sends
 * everybody else, with the words translated and the page refreshed after so
 * the server-rendered count says what just happened.
 *
 * Renders nothing until it knows this browser can do WebAuthn — the server
 * writes the sentence for a browser that cannot, or that runs no script.
 */
export function PasskeyButton({ deviceHint }: { deviceHint: string }) {
  const t = useTranslations("setup.passkey");
  const router = useRouter();
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
  }, []);

  if (!supported) return null;

  async function add() {
    setState("working");
    setMessage(null);
    const res = await authClient.passkey.addPasskey({ name: deviceHint });
    if (res?.error) {
      // Better Auth's own words when it has them, which are English: a
      // cancelled system prompt is a choice, not a failure, and it says so.
      setState("error");
      setMessage(res.error.message ?? t("failed"));
      return;
    }
    setState("done");
    router.refresh();
  }

  if (state === "done") return <Notice tone="good" label={t("good")}>{t("done")}</Notice>;

  return (
    <div className="flex flex-col items-start gap-[13.2px]">
      <Button type="button" onClick={add} disabled={state === "working"}>
        {state === "working" ? t("working") : t("add")}
      </Button>
      {message && <Notice tone="warn" label={t("holdOn")}>{message}</Notice>}
    </div>
  );
}
