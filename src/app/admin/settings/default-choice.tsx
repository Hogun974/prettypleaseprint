import type { Resolved } from "@/lib/settings";

/**
 * A default chosen from a list. The built-in default's option sends an empty
 * value, "back to the default" (`choiceFromForm` in src/lib/settings.ts), so
 * an untouched form saves nothing; a saved value that no longer validates
 * opens on the built-in one, which is what the app is using meanwhile.
 *
 * Its own file because two forms render it: /admin/settings, and the steps of
 * the first-run setup that set the same defaults (/admin/setup). Both post to
 * `saveSettings`, so the control has to send exactly the same thing from
 * either.
 */
export function DefaultChoice({
  name,
  label,
  setting,
  builtIn,
  options,
}: {
  name: string;
  label: string;
  setting: Resolved<unknown>;
  builtIn: string;
  options: Array<readonly [string, string]>;
}) {
  const current = setting.source === "saved" && !setting.problem ? (setting.stored ?? "") : "";
  return (
    <select
      id={name}
      name={name}
      aria-label={label}
      defaultValue={current === builtIn ? "" : current}
      className="w-full max-w-[420px] cursor-pointer rounded-card border-[3px] border-ink bg-cream-2 px-[15px] py-[11px] text-[16px] text-ink"
    >
      {options.map(([value, text]) => (
        <option key={value} value={value === builtIn ? "" : value}>
          {text}
        </option>
      ))}
    </select>
  );
}
