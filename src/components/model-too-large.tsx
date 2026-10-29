import { getTranslations } from "next-intl/server";

import { getTicketWords } from "@/i18n/tickets";
import { VIEWER_MAX_BYTES } from "@/lib/upload-limits";

/**
 * What the viewer says instead of hanging.
 *
 * Two jobs, and the second is the one usually skipped. It has to say *why*
 * nothing is loading — otherwise a blank panel on a perfectly good file reads
 * as a broken app — and it has to give the size some meaning. "180 MB" is a
 * number; "three and a half times what a browser can rotate" is an answer, and
 * the bars make that true at a glance rather than on arithmetic.
 *
 * A server component, drawn by the ticket page in place of the viewer: its
 * words then stay on the pages that show it.
 *
 * Amber rather than red: nothing has failed. The file is intact, it is stored,
 * it will print. Only the preview is declined, and the two things that actually
 * get the model onto a plate are both still there.
 */
export async function ModelTooLarge({ fileSize, slicerLabel }: { fileSize: number; slicerLabel: string }) {
  // The larger bar is the full width; the limit is drawn to scale against it.
  const limitWidth = Math.max(4, (VIEWER_MAX_BYTES / fileSize) * 100);
  const times = fileSize / VIEWER_MAX_BYTES;
  const [t, words] = await Promise.all([getTranslations("modelTooLarge"), getTicketWords()]);
  const locale = words.locale;
  const bytes = words.bytes;
  // English keeps `toFixed`, exactly as before; French writes a decimal comma.
  const timesText = locale === "en" ? times.toFixed(1) : times.toFixed(1).replace(".", ",");

  return (
    <div className="rounded-panel border-[3px] border-ink bg-sun-wash p-[22px] shadow-stamp-lg">
      <p className="m-0 font-mono text-[11.5px] font-bold uppercase tracking-[0.12em] text-sun-dk">
        {t("kicker")}
      </p>
      <h3 className="m-0 mt-[6px] font-display text-[21px] leading-[1.15] text-ink">
        {t("title")}
      </h3>
      <p className="m-0 mt-[8px] max-w-[46ch] text-[14.5px] leading-[1.5] text-ink-2">
        {t("body", { size: bytes(fileSize) })}
      </p>

      {/* The comparison. Drawn to scale, because the point is the gap. */}
      <div className="mt-[17.6px] flex flex-col gap-[8px]">
        <div>
          <div className="mb-[3px] flex items-baseline justify-between gap-[8px]">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-2">
              {t("browserHandles")}
            </span>
            <span className="font-mono text-[11.5px] font-bold text-ink">
              {bytes(VIEWER_MAX_BYTES)}
            </span>
          </div>
          <div aria-hidden className="h-[16px] overflow-hidden rounded-chip border-2 border-ink bg-cream">
            <div className="h-full bg-aqua" style={{ width: `${limitWidth}%` }} />
          </div>
        </div>

        <div>
          <div className="mb-[3px] flex items-baseline justify-between gap-[8px]">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-2">
              {t("thisModel")}
            </span>
            <span className="font-mono text-[11.5px] font-bold text-cherry-dk">
              {bytes(fileSize)} · {timesText}&times;
            </span>
          </div>
          <div aria-hidden className="h-[16px] overflow-hidden rounded-chip border-2 border-ink bg-cream">
            <div className="h-full w-full bg-cherry" />
          </div>
        </div>
      </div>

      <p className="m-0 mt-[17.6px] border-t-2 border-dashed border-ink-3 pt-[11px] text-[13.5px] leading-[1.5] text-ink-2">
        {t.rich("nothingWrong", {
          slicer: slicerLabel,
          b: (chunks) => <strong>{chunks}</strong>,
        })}
      </p>
    </div>
  );
}
