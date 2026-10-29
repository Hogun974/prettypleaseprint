import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { getRelativeTime } from "@/i18n/server";
import { db } from "@/lib/db";
import { printerName, requireUser, storyScope } from "@/lib/authz";
import { storyRef } from "@/lib/scope";
import { formatBytes } from "@/lib/models";
import { AppHeader } from "@/components/app-header";
import { Kicker, Notice, StatusChip } from "@/components/ui";
import { ColorSwatch } from "@/components/color-swatch";
import { Toast } from "@/components/toast";
import { PreferencesForm } from "./preferences-form";

import type { StoryStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * What counts as printed: it came off the plate, whether or not it has been
 * handed over yet. Named rather than repeated as a literal pair, because the
 * last time the flow was reordered these three call sites had to be found by
 * grep.
 */
const PRINTED: StoryStatus[] = ["Delivery", "Done"];


/**
 * The profile. Handoff §6.
 *
 * Everything on this page is scoped by the same rule as the board: a client
 * counts and lists only their own tickets, the printer owner sees the group.
 * The handoff calls this out explicitly, and it is the easiest place to leak
 * — a stat is still a fact about someone else's data.
 *
 * This is also where declined tickets finally surface. They are deliberately
 * off the rail, which left them reachable only by URL; the whole history
 * belongs here, including the parts that did not happen.
 *
 * And where a person sets how the app speaks and looks to them, at the foot:
 * `PreferencesForm`. The page speaks the reader's language; what it lists —
 * titles, file names, materials, the tip offered — is shown as it was written.
 */

type Card = { value: string; label: string; skin: string };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ preferences?: string }>;
}) {
  const [user, { preferences }, t, a, ago] = await Promise.all([
    requireUser("/me"),
    searchParams,
    getTranslations("preferences"),
    getTranslations("account"),
    getRelativeTime(),
  ]);
  const owner = await printerName();
  const isAdmin = user.role === "admin";
  const scope = storyScope(user);

  const [stories, finished, beers, favourite, waiting, bytes] = await Promise.all([
    db.story.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      include: { uploader: { select: { name: true, initials: true } } },
    }),
    db.story.count({ where: { AND: [scope, { status: { in: PRINTED } }] } }),
    // A beer is owed once the work is actually done — not when it is asked for.
    db.story.count({
      where: { AND: [scope, { tip: "A beer" }, { status: { in: PRINTED } }] },
    }),
    db.story.groupBy({
      by: ["material"],
      where: scope,
      _count: { material: true },
      orderBy: { _count: { material: "desc" } },
      take: 1,
    }),
    db.story.count({ where: { AND: [scope, { status: "Requested" }] } }),
    db.story.aggregate({
      where: { AND: [scope, { status: { in: PRINTED } }] },
      _sum: { fileSize: true },
    }),
  ]);

  const inHand = stories.filter((s) => s.status === "Done").length;
  const waitingToCollect = stories.filter((s) => s.status === "Delivery").length;
  const usual = favourite[0]?.material ?? "—";

  /*
   * The handoff's admin card here is "Printer time given", and there is no
   * honest number behind it: print-time estimates were removed because a
   * figure derived from a bounding box is a guess dressed as a measurement.
   * Rather than invent one, this counts something real — how much geometry
   * has actually come off the plate. Swap it back the day a slicer is wired
   * in and the hours are known rather than assumed.
   */
  const cards: Card[] = isAdmin
    ? [
        { value: String(finished), label: a("cards.printedForGroup"), skin: "bg-aqua" },
        { value: String(waiting), label: a("cards.waitingOnYou"), skin: "bg-sun" },
        { value: formatBytes(bytes._sum.fileSize ?? 0), label: a("cards.geometry"), skin: "bg-cream-2" },
        { value: String(beers), label: a("cards.beersOwedYou"), skin: "bg-mint" },
      ]
    : [
        { value: String(stories.length), label: a("cards.requestsMade"), skin: "bg-aqua" },
        {
          value: String(waitingToCollect > 0 ? waitingToCollect : inHand),
          label: waitingToCollect > 0 ? a("cards.readyToCollect") : a("cards.inYourHands"),
          skin: waitingToCollect > 0 ? "bg-cherry-wash" : "bg-mint",
        },
        { value: String(beers), label: a("cards.beersOwedTo", { owner }), skin: "bg-sun" },
        { value: usual, label: a("cards.usualMaterial"), skin: "bg-cream-2" },
      ];

  return (
    <>
      <AppHeader user={user} active="/me" />

      <main className="mx-auto w-full max-w-[1180px] px-[26.4px] pb-[80px] pt-[35.2px]">
        <div className="mb-[35.2px] flex flex-wrap items-center gap-[22px]">
          <span
            aria-hidden
            className="flex h-[92px] w-[92px] flex-none items-center justify-center rounded-full border-[3px] border-ink bg-aqua font-mono text-[30px] font-bold text-ink shadow-stamp-lg"
          >
            {user.initials}
          </span>
          <div>
            <Kicker>{isAdmin ? a("kickerOwner") : a("kickerMember")}</Kicker>
            <h1 className="m-0 mb-[6px] text-[38px] leading-[1] text-ink">
              {user.name}
            </h1>
            <p className="m-0 text-[15.5px] text-ink-2">
              {isAdmin ? a("roleOwner") : a("roleMember", { owner })}
            </p>
          </div>
        </div>

        <div className="mb-[35.2px] grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-[13.2px]">
          {cards.map((c) => (
            <div
              key={c.label}
              className={`rounded-panel border-[3px] border-ink ${c.skin} p-[17.6px] shadow-stamp`}
            >
              <p className="m-0 font-display text-[36px] leading-[1] text-ink">
                {c.value}
              </p>
              <p className="m-0 mt-[8px] font-mono text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink">
                {c.label}
              </p>
            </div>
          ))}
        </div>

        <h2 className="m-0 mb-[13.2px] font-display text-[26px] text-ink">
          {isAdmin ? a("listOwner") : a("listMember")}
        </h2>

        <div className="overflow-hidden rounded-panel border-[3px] border-ink bg-porcelain shadow-stamp">
          {stories.length === 0 ? (
            <p className="m-0 p-[22px] font-mono text-[12px] uppercase tracking-[0.06em] text-ink-3">
              {isAdmin ? a("emptyOwner") : a("emptyMember")}
            </p>
          ) : (
            stories.map((story, i) => (
              <div
                key={story.id}
                className={`flex flex-wrap items-center gap-[15px] p-[15px] ${
                  i < stories.length - 1 ? "border-b-2 border-dashed border-rule" : ""
                } ${story.status === "Declined" ? "bg-cream-2" : ""}`}
              >
                <ColorSwatch
                  mode={story.colorMode}
                  style={story.colorStyle ?? story.colorHex}
                  className="h-[40px] w-[40px] flex-none rounded-full border-[3px] border-ink"
                />
                <div className="min-w-[180px] flex-[1_1_240px]">
                  <Link
                    href={`/story/${story.id}`}
                    className="block font-display text-[17px] leading-[1.2] text-ink hover:text-cherry-dk"
                  >
                    {story.title}
                  </Link>
                  <p className="m-0 mt-[3px] font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
                    {storyRef(story.id)} · {story.filename}
                    {isAdmin ? ` · ${story.uploader.name}` : ""} ·{" "}
                    {ago(story.createdAt)}
                  </p>
                </div>
                <StatusChip status={story.status} />
                {story.flagged && (
                  <span className="rounded-chip border-2 border-ink bg-cherry px-[9px] py-[2px] font-mono text-[10.5px] font-bold uppercase text-ink">
                    {a("needsALook")}
                  </span>
                )}
                <span className="w-[120px] font-mono text-[11px] uppercase tracking-[0.04em] text-ink-3">
                  {story.tip}
                </span>
              </div>
            ))
          )}
        </div>

        <p className="m-0 mt-[13.2px] font-mono text-[11px] uppercase tracking-[0.05em] text-ink-3">
          {a("declinedToo")}
        </p>

        <PreferencesForm
          notice={
            preferences === "refused" && (
              <div className="mb-[13.2px]">
                <Notice tone="warn" label={a("holdOn")}>{t("refused")}</Notice>
              </div>
            )
          }
        />
      </main>

      {preferences === "saved" && <Toast>{t("saved")}</Toast>}
    </>
  );
}
