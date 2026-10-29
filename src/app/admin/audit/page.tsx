import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/authz";
import { getRelativeTime } from "@/i18n/server";
import { AppHeader } from "@/components/app-header";
import { AuditDashboard } from "@/components/audit-dashboard";
import { REFUSAL_ACTIONS, mix, refusals, stages } from "@/lib/dashboard";
import { Kicker } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * The audit log, and the three panels above it. Admin only.
 *
 * Deliberately a page a human reads rather than an alerting pipeline: for one
 * printer and a handful of colleagues, a screen the owner can glance at beats
 * thresholds nobody tunes and alerts everyone learns to ignore. The rows are
 * already there if that changes — recording is the part that cannot be
 * backfilled.
 *
 * That argument only holds if somebody actually looks, and a wall of rows is
 * not something anybody opens twice. The panels are the answer: refusals,
 * where work is sitting, and what gets asked for — the three questions a person
 * arrives with, none of which a log can answer by being scrolled. They are pure
 * aggregation over rows that already existed (`src/lib/dashboard.ts`); nothing
 * new is recorded for them.
 */

type Lens = "all" | "access" | "uploads";

/** Each lens's label is `admin.audit.lens.<key>`. */
const LENSES: Array<{ key: Lens; actions?: string[] }> = [
  { key: "all" },
  {
    key: "access",
    actions: [
      "invite.sent", "invite.resent", "invite.revoked", "invite.accepted",
      "invite.rejected", "auth.signed_in", "auth.signed_out", "user.role_changed",
    ],
  },
  {
    key: "uploads",
    actions: [
      "story.created", "upload.rejected", "story.status_changed",
      "story.declined", "story.flagged", "story.priority_changed", "file.downloaded",
    ],
  },
];

/**
 * Refusals are the rows worth noticing — a run of them from one place is the
 * shape of somebody trying things. Everything else is normal traffic.
 *
 * The list lives in `dashboard.ts` so the count at the top, the tint in the
 * table and the panel cannot disagree. It gained `file.refused`, which had been
 * missing here: that verb fires when an account asks for a model it may not
 * see, which is the refusal most worth noticing and was the one not counted.
 */
const REFUSALS = new Set<string>(REFUSAL_ACTIONS);

function tone(action: string): string {
  if (REFUSALS.has(action)) return "bg-cherry text-ink";
  if (action.startsWith("auth.")) return "bg-aqua-wash text-ink";
  if (action.startsWith("invite.")) return "bg-mint-wash text-ink";
  return "bg-cream-2 text-ink-2";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ lens?: string }>;
}) {
  const [admin, t, ago] = await Promise.all([
    requireAdmin(),
    getTranslations("admin.audit"),
    getRelativeTime(),
  ]);
  const { lens: raw } = await searchParams;
  const lens = (LENSES.find((l) => l.key === raw)?.key ?? "all") as Lens;
  const actions = LENSES.find((l) => l.key === lens)?.actions;

  const where: Prisma.AuditEventWhereInput = actions ? { action: { in: actions } } : {};

  const [events, refusalsToday, refusalPanel, stagePanel, mixPanel] = await Promise.all([
    db.auditEvent.findMany({ where, orderBy: { at: "desc" }, take: 200 }),
    db.auditEvent.count({
      where: {
        action: { in: [...REFUSALS] },
        at: { gt: new Date(Date.now() - 86_400_000) },
      },
    }),
    refusals(),
    stages(),
    mix(),
  ]);

  return (
    <>
      <AppHeader user={admin} active="/admin/audit" />

      <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <Kicker>{t("kicker")}</Kicker>
        <h1 className="m-0 mb-[13.2px] text-[46px] leading-[0.98] text-ink">
          {t("title")}
        </h1>
        <p className="m-0 mb-[26.4px] max-w-[620px] text-[16.5px] leading-[1.5] text-ink-2 text-pretty">
          {t("lead")}
          {refusalsToday > 0 && (
            <>
              {" "}
              <strong className="font-bold text-cherry-dk">
                {t("refusalsToday", { count: refusalsToday })}
              </strong>{" "}
              {t("worthALook")}
            </>
          )}
        </p>

        <AuditDashboard refusals={refusalPanel} stages={stagePanel} mix={mixPanel} />

        <nav className="mb-[17.6px] flex flex-wrap gap-[4.4px]">
          {LENSES.map((l) => (
            <Link
              key={l.key}
              href={l.key === "all" ? "/admin/audit" : `/admin/audit?lens=${l.key}`}
              aria-current={l.key === lens ? "page" : undefined}
              className={`stamp cursor-pointer rounded-chip border-[3px] border-ink px-[15px] py-[6px] font-mono text-[12px] font-bold uppercase tracking-[0.06em] ${
                l.key === lens ? "bg-cherry-dk text-cream" : "bg-porcelain text-ink hover:bg-sun"
              }`}
            >
              {t(`lens.${l.key}`)}
            </Link>
          ))}
        </nav>

        <div className="overflow-x-auto rounded-panel border-[3px] border-ink bg-porcelain shadow-stamp">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr className="border-b-[3px] border-ink bg-cream-2">
                {(["when", "action", "who", "what", "from"] as const).map((h) => (
                  <th
                    key={h}
                    className="px-[17.6px] py-[11px] text-left font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink"
                  >
                    {t(`column.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-[17.6px] py-[22px] font-mono text-[12px] uppercase text-ink-3">
                    {t("empty")}
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b-2 border-dashed border-rule last:border-b-0">
                  <td className="whitespace-nowrap px-[17.6px] py-[11px] align-top font-mono text-[12px] tabular-nums text-ink-3">
                    <time dateTime={e.at.toISOString()} title={e.at.toISOString()}>
                      {ago(e.at)}
                    </time>
                  </td>
                  <td className="whitespace-nowrap px-[17.6px] py-[11px] align-top">
                    <span
                      className={`rounded-chip border-2 border-ink px-[9px] py-[2px] font-mono text-[11px] font-bold ${tone(e.action)}`}
                    >
                      {e.action}
                    </span>
                  </td>
                  <td className="px-[17.6px] py-[11px] align-top text-[13.5px]">
                    {e.actorEmail ?? <span className="text-ink-3">—</span>}
                  </td>
                  <td className="px-[17.6px] py-[11px] align-top text-[13.5px]">
                    <span className="font-mono text-[12.5px]">{e.subject ?? "—"}</span>
                    {e.detail != null && (
                      <Detail detail={e.detail as Record<string, unknown>} label={(k, value) => t(`detail.${k}`, { value })} />
                    )}
                  </td>
                  <td className="px-[17.6px] py-[11px] align-top font-mono text-[12px] text-ink-3">
                    {e.ip ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="m-0 mt-[13.2px] font-mono text-[11.5px] uppercase text-ink-3">
          {t(events.length === 200 ? "showingOfMore" : "showing", { count: events.length })}
        </p>
      </main>
    </>
  );
}

/**
 * The few fields worth showing inline; the rest stay in the database. The
 * field's name is said in the reader's language; its value is what was
 * recorded, as it was recorded.
 */
const INTERESTING = ["reason", "title", "filename", "format", "dims", "role"] as const;

function Detail({
  detail,
  label,
}: {
  detail: Record<string, unknown>;
  label: (key: (typeof INTERESTING)[number], value: string) => string;
}) {
  const shown = INTERESTING
    .filter((k) => detail[k] != null)
    .map((k) => label(k, String(detail[k])));
  if (shown.length === 0) return null;
  return (
    <span className="mt-[3px] block text-[12.5px] text-ink-3">
      {shown.join(" · ")}
    </span>
  );
}
