import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/authz";
import { PASSKEY_RP_NAME } from "@/lib/auth";
import { ipSource } from "@/lib/client-ip";
import { mailTransport } from "@/lib/email";
import { IMPORT_SOURCES, SOURCE_LABEL } from "@/lib/import-source";
import { sourceUrl } from "@/lib/runtime";
import { SETTINGS, currentSettings, mailFromLine, type Resolved } from "@/lib/settings";
import { AppHeader } from "@/components/app-header";
import { Kicker, Notice } from "@/components/ui";
import { Toast } from "@/components/toast";
import { saveSettingsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Instance-wide settings, and a plain account of what stays in the
 * environment. Admin-only: `requireAdmin` answers 404, so a client learns
 * nothing about this route.
 *
 * One plain server-rendered form, so it works with JavaScript off, like the
 * other admin screens. A field the environment sets is not an input at all —
 * it is shown with the variable that sets it, because the environment wins
 * and a field that accepted a value it would then ignore would be lying.
 *
 * The lower panel never shows a secret or a connection string: it says
 * *whether* mail is configured and by which kind of transport, never where.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ toast?: string; error?: string }>;
}) {
  const [{ toast, error }, admin] = await Promise.all([searchParams, requireAdmin()]);
  const settings = await currentSettings();
  const { importSources, mailFromName } = settings;

  const editable = Object.values(settings).some((s) => s.source !== "env");
  const transport = mailTransport();
  const sender = mailFromLine(
    process.env,
    mailFromName.source === "saved" && !mailFromName.problem ? mailFromName.value : null,
  );
  const proxy = ipSource();

  return (
    <>
      <AppHeader user={admin} active="/admin/settings" />

      <main className="mx-auto w-full max-w-[880px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <Kicker>Settings</Kicker>
        <h1 className="m-0 mt-[6px] mb-[8px] font-display text-[30px] leading-[1.05] text-ink">
          House rules
        </h1>
        <p className="m-0 mb-[22px] max-w-[62ch] text-[15px] text-ink-2">
          The few things about this instance you can change without touching the
          server. A save is in effect from the next request — no restart. Anything
          set in the environment wins, and is shown here locked with the variable
          that sets it.
        </p>

        {error && (
          <div className="mb-[17.6px]">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        <form
          action={saveSettingsAction}
          className="mb-[35.2px] rounded-panel border-[3px] border-ink bg-porcelain p-[17.6px] shadow-stamp sm:p-[22px]"
        >
          {/* Import from a link */}
          <Field
            title={SETTINGS.importSources.label}
            setting={importSources}
            help={
              <>
                Lets a request start from a model&rsquo;s page instead of an upload.
                The server then fetches the file itself, so it needs outbound HTTPS
                to that site.
              </>
            }
          >
            {importSources.source === "env" ? (
              <Locked>
                {importSources.value.length > 0
                  ? importSources.value.map((s) => SOURCE_LABEL[s]).join(", ")
                  : "Off"}
              </Locked>
            ) : (
              <div className="flex flex-wrap gap-[8.8px]">
                {/* Unticked boxes send nothing; this says the list was on the
                    form, so all boxes clear means "off". */}
                <input type="hidden" name="importSources" value="" />
                {IMPORT_SOURCES.map((source) => (
                  <label
                    key={source}
                    className="flex cursor-pointer items-center gap-[8px] rounded-chip border-[3px] border-ink bg-cream-2 px-[14px] py-[8px] text-[15px] font-bold text-ink has-[:checked]:bg-mint-wash"
                  >
                    <input
                      type="checkbox"
                      name="importSources"
                      value={source}
                      defaultChecked={importSources.value.includes(source)}
                      className="h-[18px] w-[18px] accent-ink"
                    />
                    {SOURCE_LABEL[source]}
                  </label>
                ))}
              </div>
            )}
          </Field>

          {/* Sender name */}
          <Field
            title={SETTINGS.mailFromName.label}
            setting={mailFromName}
            help={
              <>
                The name invitations and reset links arrive from. The address stays
                in <code className="font-mono text-[13px]">MAIL_FROM</code>.
              </>
            }
            last
          >
            {mailFromName.source === "env" ? (
              <Locked>{mailFromName.value}</Locked>
            ) : (
              <input
                id="mailFromName"
                name="mailFromName"
                aria-label={SETTINGS.mailFromName.label}
                defaultValue={mailFromName.source === "saved" ? (mailFromName.stored ?? "") : ""}
                placeholder={mailFromName.value ?? "No name — just the address"}
                maxLength={80}
                autoComplete="off"
                className="w-full rounded-card border-[3px] border-ink bg-cream-2 px-[15px] py-[11px] text-[16px] text-ink placeholder:text-ink-3"
              />
            )}
            <p className="m-0 mt-[8.8px] font-mono text-[12px] text-ink-2">
              Mail goes out as <span className="font-bold text-ink">{sender}</span>
              {transport === "none" && " — once there is a transport; there is none yet."}
            </p>
          </Field>

          {editable ? (
            <div className="mt-[17.6px] flex flex-wrap items-center gap-[13.2px]">
              <button
                type="submit"
                className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[24px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
              >
                Save
              </button>
              <span className="max-w-[48ch] text-[13px] text-ink-3">
                Asks for your password or passkey again if you signed in more than
                five minutes ago.
              </span>
            </div>
          ) : (
            <p className="m-0 mt-[17.6px] font-mono text-[12px] uppercase tracking-[0.05em] text-ink-3">
              Everything here is set by the environment.
            </p>
          )}
        </form>

        {/* What stays in the environment */}
        <section>
          <h2 className="m-0 mb-[6px] font-display text-[20px] text-ink">Set in the environment</h2>
          <p className="m-0 mb-[13.2px] max-w-[62ch] text-[14px] text-ink-2">
            Read-only. These are decided where the app is started, in{" "}
            <code className="font-mono text-[13px]">.env.docker</code>, and change with a restart.
          </p>
          <dl className="m-0 grid grid-cols-1 gap-x-[22px] gap-y-[13.2px] rounded-card border-[3px] border-ink bg-cream-2 p-[17.6px] sm:grid-cols-[minmax(0,200px)_1fr]">
            <Row term="Sign-in">
              Username and password · passkeys · API bearer tokens
            </Row>
            <Row term="Breach check" env="HIBP_DISABLED">
              {process.env.HIBP_DISABLED === "true"
                ? "Off — passwords are not checked against known breaches"
                : "On — passwords in a known breach are refused"}
            </Row>
            <Row term="Passkey name" env="PASSKEY_RP_NAME">
              {PASSKEY_RP_NAME}
              <Aside>
                Stays in the environment: the passkey library reads it once, when
                the app starts, and a passkey keeps the name it was made with.
              </Aside>
            </Row>
            <Row term="Mail" env={transport === "resend" ? "RESEND_API_KEY" : "SMTP_URL"}>
              {transport === "resend"
                ? "Configured — Resend"
                : transport === "smtp"
                  ? "Configured — SMTP"
                  : "Not configured — invitation and reset links are shown to you to hand over"}
            </Row>
            <Row term="Client address" env="TRUST_PROXY_HEADERS">
              {proxy === "cloudflare"
                ? "From CF-Connecting-IP (Cloudflare)"
                : proxy === "forwarded"
                  ? "From the left-most X-Forwarded-For"
                  : "Not trusted — the audit trail records no address"}
            </Row>
            <Row term="Source" env="SOURCE_URL">
              <a href={sourceUrl()} className="break-all text-ink underline decoration-2 underline-offset-2">
                {sourceUrl()}
              </a>
            </Row>
            <Row term="Running" env="PPP_TAG">
              {process.env.PPP_TAG ? (
                <span className="font-mono">{process.env.PPP_TAG}</span>
              ) : (
                "Not set"
              )}
            </Row>
          </dl>
        </section>
      </main>

      {toast && <Toast>{toast}</Toast>}
    </>
  );
}

/** One setting on the form: its name, whether it is locked, and the control. */
function Field({
  title,
  setting,
  help,
  children,
  last = false,
}: {
  title: string;
  setting: Resolved<unknown>;
  help: ReactNode;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <fieldset
      className={`m-0 min-w-0 border-0 p-0 ${last ? "" : "mb-[17.6px] border-b-[3px] border-dashed border-ink-3 pb-[17.6px]"}`}
    >
      <legend className="contents">
        <span className="mb-[6px] flex flex-wrap items-center gap-[8.8px]">
          <span className="font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">{title}</span>
          {setting.source === "env" && (
            <span className="rounded-chip border-2 border-ink bg-sun px-[10px] py-[2px] font-mono text-[11px] font-bold text-ink">
              set by <code>{setting.envName}</code>
            </span>
          )}
        </span>
      </legend>
      <p className="m-0 mb-[11px] max-w-[62ch] text-[14px] text-ink-2">{help}</p>
      {setting.problem && (
        <div className="mb-[11px]">
          <Notice tone="warn">{setting.problem}</Notice>
        </div>
      )}
      {children}
    </fieldset>
  );
}

/** The value an environment variable fixes, shown rather than offered. */
function Locked({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 inline-block rounded-card border-[3px] border-dashed border-ink-3 bg-cream-2 px-[15px] py-[9px] text-[15px] font-bold text-ink">
      {children}
    </p>
  );
}

function Row({ term, env, children }: { term: string; env?: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2">
        {term}
        {env && <span className="mt-[2px] block font-normal normal-case tracking-normal text-ink-3">{env}</span>}
      </dt>
      <dd className="m-0 text-[15px] text-ink">{children}</dd>
    </>
  );
}

function Aside({ children }: { children: ReactNode }) {
  return <span className="mt-[4px] block text-[13px] text-ink-3">{children}</span>;
}
