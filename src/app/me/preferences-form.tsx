import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { LOCALES, LOCALE_NAMES } from "@/i18n/locales";
import type { Preferences } from "@/lib/preferences";
import { SLICERS, slicerName, type SlicerId } from "@/lib/slicers";
import { THEME_CHOICES, THEME_KEY } from "@/lib/theme";
import { viewerPreferences } from "@/lib/viewer-preferences";
import { savePreferencesAction } from "./actions";

/**
 * The person's own language, theme and slicer, on /me.
 *
 * A plain server-rendered form, so it works with JavaScript off, like every
 * other form in the app. Each select opens on "Same as the house (…)", which
 * sends an empty value — stored as null, "follow the instance" — and names
 * what the house serves today, so nobody has to guess what leaving it means.
 */
export async function PreferencesForm({ notice }: { notice?: ReactNode }) {
  const [t, themes, { person, instance }] = await Promise.all([
    getTranslations("preferences"),
    getTranslations("themes"),
    viewerPreferences(),
  ]);
  const mine: Preferences = person ?? { locale: null, theme: null, slicer: null };
  const slicerLabel = (id: SlicerId) => slicerName(id) ?? t("otherSlicer");

  return (
    <section id="preferences" className="mt-[35.2px]">
      <h2 className="m-0 mb-[6px] font-display text-[26px] text-ink">{t("title")}</h2>
      <p className="m-0 mb-[13.2px] max-w-[62ch] text-[14.5px] text-ink-2">{t("lead")}</p>
      {notice}

      <form
        action={savePreferencesAction}
        className="rounded-panel border-[3px] border-ink bg-porcelain p-[17.6px] shadow-stamp sm:p-[22px]"
      >
        <div className="grid grid-cols-1 gap-[17.6px] md:grid-cols-3">
          <Choice
            name="locale"
            label={t("language")}
            help={t("languageHelp")}
            current={mine.locale}
            house={t("house", { name: LOCALE_NAMES[instance.locale] })}
            options={LOCALES.map((l) => [l, LOCALE_NAMES[l]])}
          />
          <Choice
            name="theme"
            label={t("theme")}
            current={mine.theme}
            house={t("house", { name: themes(THEME_KEY[instance.theme]) })}
            options={THEME_CHOICES.map((c) => [c, themes(THEME_KEY[c])])}
          />
          <Choice
            name="slicer"
            label={t("slicer")}
            help={t("slicerHelp")}
            current={mine.slicer}
            house={t("house", { name: slicerLabel(instance.slicer) })}
            options={SLICERS.map((s) => [s.id, slicerLabel(s.id)])}
          />
        </div>

        <div className="mt-[17.6px]">
          <button
            type="submit"
            className="stamp cursor-pointer rounded-chip border-[3px] border-ink bg-cherry-dk px-[24px] py-[11px] text-[15px] font-bold text-cream hover:bg-cherry"
          >
            {t("save")}
          </button>
        </div>
      </form>
    </section>
  );
}

/** One preference: a label, a select that opens on the house's choice, a note. */
function Choice({
  name,
  label,
  help,
  current,
  house,
  options,
}: {
  name: string;
  label: string;
  help?: string;
  current: string | null;
  house: string;
  options: Array<readonly [string, string]>;
}) {
  return (
    <div className="min-w-0">
      <label
        htmlFor={`pref-${name}`}
        className="mb-[6px] block font-mono text-[12px] font-bold uppercase tracking-[0.1em] text-ink-2"
      >
        {label}
      </label>
      <select
        id={`pref-${name}`}
        name={name}
        defaultValue={current ?? ""}
        className="w-full cursor-pointer rounded-card border-[3px] border-ink bg-cream-2 px-[12px] py-[10px] text-[15px] text-ink"
      >
        <option value="">{house}</option>
        {options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
      {help && <p className="m-0 mt-[8px] text-[13px] leading-[1.45] text-ink-2">{help}</p>}
    </div>
  );
}
