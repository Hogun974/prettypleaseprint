import { getTranslations } from "next-intl/server";

import { getRelativeTime } from "@/i18n/server";
import { formatBytes } from "@/lib/models";
import type { Mix, Refusals, Stage } from "@/lib/dashboard";

/**
 * Three panels above the log, so the page is worth opening rather than only
 * worth searching.
 *
 * The log answers "what happened to this ticket". None of these do that — they
 * answer the questions a person actually arrives with: is anything being
 * refused, where is work piling up, and what should I buy. Each is pure
 * aggregation over rows that already existed; see `src/lib/dashboard.ts`.
 *
 * Drawn with the app's own tokens rather than a charting library. A chart
 * library would be a third party in the request path, would want a CDN that
 * `script-src 'self'` refuses, and would be a lot of machinery for four bars.
 */

/** Hours, said the way a person would say them, in the reader's units. */
function duration(hours: number | null, unit: (key: "minutes" | "hours" | "days", n: number) => string): string {
  if (hours === null) return "—";
  if (hours < 1) return unit("minutes", Math.round(hours * 60));
  if (hours < 48) return unit("hours", Math.round(hours));
  return unit("days", Math.round(hours / 24));
}

/**
 * The size buckets `mix()` counts in, by their label there, to the key of
 * the same words here. A bucket this does not know keeps its label.
 */
const SIZE_KEYS: Record<string, "under1" | "1to10" | "10to50" | "over50"> = {
  "under 1 MB": "under1",
  "1 – 10 MB": "1to10",
  "10 – 50 MB": "10to50",
  "over 50 MB": "over50",
};

function Panel({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-panel border-[3px] border-ink bg-porcelain p-[19px] shadow-stamp">
      <p className="m-0 font-mono text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-3">
        {kicker}
      </p>
      <h2 className="m-0 mt-[4px] mb-[13.2px] font-display text-[19px] leading-[1.1] text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** A labelled bar. `share` is 0–1 of the widest row, so rows compare visually. */
function Bar({
  label,
  value,
  share,
  fill,
  swatch,
}: {
  label: string;
  value: string;
  share: number;
  fill: string;
  swatch?: string;
}) {
  return (
    <div>
      <div className="mb-[2px] flex items-baseline justify-between gap-[8px]">
        <span className="flex items-center gap-[6px] truncate font-mono text-[11.5px] text-ink-2">
          {swatch && (
            <span
              aria-hidden
              className="inline-block h-[10px] w-[10px] shrink-0 rounded-full border-2 border-ink"
              style={{ background: swatch }}
            />
          )}
          {label}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] font-bold tabular-nums text-ink">
          {value}
        </span>
      </div>
      <div aria-hidden className="h-[9px] overflow-hidden rounded-chip border-2 border-ink bg-cream">
        <div className={`h-full ${fill}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-3">
      {children}
    </p>
  );
}

export async function AuditDashboard({
  refusals,
  stages,
  mix,
}: {
  refusals: Refusals;
  stages: Stage[];
  mix: Mix;
}) {
  const [t, ago] = await Promise.all([getTranslations("admin.dashboard"), getRelativeTime()]);
  const unit = (key: "minutes" | "hours" | "days", n: number) => t(`unit.${key}`, { n });
  const status = (s: string) => (t.has(`status.${s}` as never) ? t(`status.${s}` as never) : s);
  const size = (label: string) => (SIZE_KEYS[label] ? t(`size.${SIZE_KEYS[label]}`) : label);
  const busiestDay = Math.max(1, ...refusals.perDay.map((d) => d.count));
  const mostWaiting = Math.max(1, ...stages.map((s) => s.waiting));
  const topMaterial = Math.max(1, ...mix.materials.map((m) => m.count));
  const topColor = Math.max(1, ...mix.colors.map((c) => c.count));
  const topSize = Math.max(1, ...mix.sizes.map((s) => s.count));

  return (
    <div className="mb-[26.4px] grid grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-[17.6px]">
      {/* ---------------- 1. refusals ---------------- */}
      <Panel kicker={t("refusals.kicker", { days: refusals.days })} title={t("refusals.title")}>
        <div className="flex items-baseline gap-[8px]">
          <span
            className={`font-display text-[38px] leading-[0.9] ${
              refusals.total > 0 ? "text-cherry-dk" : "text-ink"
            }`}
          >
            {refusals.total}
          </span>
          <span className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-ink-2">
            {/* The number stands apart, larger, so only the word is said. */}
            {t(refusals.total === 1 ? "refusals.one" : "refusals.many")}
          </span>
        </div>

        {/* One column per day. Drawn only when there is something to draw: a
            row of empty stubs reads as a chart that has not loaded, and the
            copy below already says the fortnight was quiet. */}
        {refusals.total > 0 && (
          <div aria-hidden className="mt-[11px] flex h-[34px] items-end gap-[3px]">
            {refusals.perDay.map((d) => (
              <div key={d.day.toISOString()} className="flex-1" title={`${d.count}`}>
                <div
                  className={`w-full rounded-[2px] border-2 border-ink ${
                    d.count > 0 ? "bg-cherry" : "bg-cream-2"
                  }`}
                  style={{ height: `${Math.max(4, (d.count / busiestDay) * 34)}px` }}
                />
              </div>
            ))}
          </div>
        )}

        {refusals.total === 0 ? (
          <p className="m-0 mt-[11px] text-[13.5px] leading-[1.45] text-ink-2">
            {t("refusals.none")}
          </p>
        ) : (
          <>
            <div className="mt-[13.2px] flex flex-col gap-[6px]">
              {refusals.byAction.map((a) => (
                <div key={a.action} className="flex items-baseline justify-between gap-[8px]">
                  <span className="truncate font-mono text-[11.5px] text-ink-2">{a.action}</span>
                  <span className="font-mono text-[11.5px] font-bold tabular-nums text-ink">
                    {a.count}
                  </span>
                </div>
              ))}
            </div>
            <ul className="m-0 mt-[13.2px] list-none border-t-2 border-dashed border-rule p-0 pt-[8px]">
              {refusals.recent.map((r, i) => (
                <li key={i} className="py-[3px] font-mono text-[11px] leading-[1.4] text-ink-3">
                  <span className="text-ink-2">{ago(r.at)}</span>{" "}
                  {r.actorEmail ?? t("refusals.someone")} · {r.subject ?? "—"}
                  {r.reason ? ` · ${r.reason}` : ""}
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      {/* ---------------- 2. where work sits ---------------- */}
      <Panel kicker={t("stages.kicker")} title={t("stages.title")}>
        <div className="flex flex-col gap-[9px]">
          {stages.map((s) => (
            <Bar
              key={s.status}
              label={status(s.status)}
              value={`${s.waiting}`}
              share={s.waiting / mostWaiting}
              fill={s.waiting === 0 ? "bg-chrome" : "bg-aqua"}
            />
          ))}
        </div>

        <table className="mt-[13.2px] w-full border-collapse border-t-2 border-dashed border-rule">
          <thead>
            <tr>
              {["", t("stages.longest"), t("stages.usually")].map((h) => (
                <th
                  key={h}
                  className="pt-[8px] text-left font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.status}>
                <td className="py-[2px] font-mono text-[11.5px] text-ink-2">{status(s.status)}</td>
                <td className="py-[2px] font-mono text-[11.5px] tabular-nums text-ink">
                  {duration(s.longestHours, unit)}
                </td>
                <td className="py-[2px] font-mono text-[11.5px] tabular-nums text-ink-3">
                  {duration(s.medianHours, unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 mt-[8px] text-[12px] leading-[1.45] text-ink-3">
          {t.rich("stages.usuallyHelp", { em: (chunks) => <em>{chunks}</em> })}
        </p>
      </Panel>

      {/* ---------------- 3. what gets asked for ---------------- */}
      <Panel kicker={t("mix.kicker", { count: mix.total })} title={t("mix.title")}>
        {mix.total === 0 ? (
          <Empty>{t("mix.empty")}</Empty>
        ) : (
          <>
            <p className="m-0 mb-[6px] font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-3">
              {t("mix.material")}
            </p>
            <div className="flex flex-col gap-[7px]">
              {mix.materials.map((m) => (
                <Bar key={m.label} label={m.label} value={`${m.count}`}
                     share={m.count / topMaterial} fill="bg-sun" />
              ))}
            </div>

            <p className="m-0 mb-[6px] mt-[13.2px] font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-3">
              {t("mix.colour")}
            </p>
            <div className="flex flex-col gap-[7px]">
              {mix.colors.slice(0, 5).map((c) => (
                <Bar key={c.label} label={c.label} value={`${c.count}`} swatch={c.hex}
                     share={c.count / topColor} fill="bg-mint" />
              ))}
            </div>

            <p className="m-0 mb-[6px] mt-[13.2px] font-mono text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-3">
              {t("mix.size", { largest: formatBytes(mix.largestBytes) })}
            </p>
            <div className="flex flex-col gap-[7px]">
              {mix.sizes.map((s) => (
                <Bar key={s.label} label={size(s.label)} value={`${s.count}`}
                     share={s.count / topSize} fill="bg-chrome-dk" />
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
