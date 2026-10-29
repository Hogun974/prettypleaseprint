import { z } from "zod";
import type { InstanceSettings } from "@prisma/client";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/locales";
import { db } from "@/lib/db";
import { enabledSources, type ImportSource } from "@/lib/import-source";
import { DEFAULT_SLICER, SLICER_IDS, type SlicerId } from "@/lib/slicers";
import { DEFAULT_THEME, THEME_CHOICES, type ThemeChoice } from "@/lib/theme";

/**
 * Instance-wide settings: the few things the printer owner changes at
 * `/admin/settings` instead of in `.env.docker` with a restart.
 *
 * Three rules, and every one of them is here rather than at a call site:
 *
 *   - **The environment wins.** A variable that says something about a setting
 *     is used, and the page shows the field locked and names the variable. A
 *     deployment that configured itself in `.env.docker` keeps doing exactly
 *     what it did; the page is a second door, never a second opinion.
 *   - **The defaults are today's behaviour.** Nothing is written by the
 *     migration, and a missing row or a null column reads as "not set here".
 *     An upgraded instance cannot tell the table exists until its owner saves.
 *   - **Read on every use.** No cache, no copy at module load: one primary-key
 *     lookup per request that needs a setting, so a save is in effect from the
 *     next request without a restart. That is also why a value that cannot be
 *     read per request is not here — see `PASSKEY_RP_NAME` in `auth.ts`.
 *
 * No `server-only` guard, deliberately, for the same reason `password-reset.ts`
 * has none: `email.ts` reads the sender name from here, the verification suites
 * import `invites.ts` which imports `email.ts`, and the pure rules below are
 * exactly what `verify:settings` wants to call directly. The owner's write path,
 * which audits, is `settings-admin.ts` and is guarded.
 *
 * A setting is one entry in `SETTINGS` plus one nullable column on
 * `InstanceSettings`. The registry is typed off the Prisma row, so a column
 * without an entry, or an entry without a column, does not compile.
 */

type Env = Record<string, string | undefined>;

/** The columns of the one row that are settings, rather than bookkeeping. */
type Row = Omit<InstanceSettings, "id" | "updatedAt">;
export type SettingKey = keyof Row;

/** What a column holds when it holds something. */
type Column<K extends SettingKey> = NonNullable<Row[K]>;

type Spec<K extends SettingKey, Value> = {
  /** What the page and every refusal call it. */
  label: string;
  /**
   * The variable that overrides it, and what that variable says about it — in
   * the column's own format, or undefined when it says nothing.
   *
   * `asWritten` is for a variable the app hands on untouched and only reads
   * from to show it: its text is not put through `schema`, whose rules are for
   * what the owner types, not for a value that already works.
   */
  env?: { name: string; read: (env: Env) => Column<K> | undefined; asWritten?: true };
  /**
   * Whatever is stored, pinned or submitted, to the value the app uses. Its
   * refusals are shown to the owner as written, so they say what is wrong.
   */
  schema: z.ZodType<Value, Column<K>>;
  /** A value back to the column's canonical form, for storing. */
  store: (value: Value) => Column<K>;
  /** Nobody has said anything: what the app did before this setting existed. */
  fallback: (env: Env) => Value;
  /**
   * What the form sent: the column's form of it, null for "back to the
   * default", undefined when the form did not carry this setting at all.
   */
  fromForm: (form: FormData) => Column<K> | null | undefined;
};

/**
 * A variable that is set to nothing says nothing.
 *
 * Templates and compose files leave variables empty far more often than an
 * operator means "off, and lock it" — and an empty `IMPORT_SOURCES` already
 * meant the same as an unset one before the page existed.
 */
function said(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

// ---------------------------------------------------------------------------
// Mail sender: the address is the environment's, the name may be the owner's
// ---------------------------------------------------------------------------

/** What `email.ts` sent before any of this, when `MAIL_FROM` was unset. */
const DEFAULT_ADDRESS = "printer@example.org";
const DEFAULT_NAME = "Pretty Please Print";

/**
 * `Name <address>` or a bare address, split. The name loses one layer of
 * quotes; a line that is not in either shape is all address, which is what
 * the transport would have made of it anyway.
 */
export function parseMailFrom(raw: string): { name?: string; address: string } {
  const match = /^\s*(.*?)\s*<\s*([^<>\s]+)\s*>\s*$/.exec(raw);
  if (!match) return { address: raw.trim() };
  let name = match[1]!.trim();
  if (name.length >= 2 && name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return name ? { name, address: match[2]! } : { address: match[2]! };
}

/**
 * The `From` line for a message.
 *
 * With nothing saved this is, character for character, what the app sent
 * before the page existed: `MAIL_FROM` as written, or the built-in default.
 * A saved name only ever *adds* a name to an address that has none, or
 * replaces the built-in one; a `MAIL_FROM` that carries its own name is left
 * alone, because the environment wins. The name is always quoted, and the
 * schema refuses the two characters that could break out of the quotes, so a
 * name cannot add a recipient or a header.
 */
export function mailFromLine(env: Env, savedName: string | null): string {
  const raw = said(env, "MAIL_FROM");
  if (raw === undefined) {
    return `${savedName ? `"${savedName}"` : DEFAULT_NAME} <${DEFAULT_ADDRESS}>`;
  }
  const parsed = parseMailFrom(raw);
  if (parsed.name !== undefined || !savedName) return raw;
  return `"${savedName}" <${parsed.address}>`;
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/**
 * The import list, through the same parser `IMPORT_SOURCES` goes through, so
 * a name that is not a source is refused by name from either door — the
 * loudness `enabledSources` exists for does not get quieter for having moved.
 */
const importSourcesSchema = z.string().transform((raw, ctx): ImportSource[] => {
  try {
    return enabledSources(raw, "The import setting");
  } catch (error) {
    ctx.addIssue({ code: "custom", message: (error as Error).message });
    return z.NEVER;
  }
});

const mailFromNameSchema = z
  .string()
  .trim()
  .min(1, "Give the sender a name, or leave it empty for the default.")
  .max(80, "Keep it under 80 characters.")
  // Control characters (a line break is a new header), and the quote and
  // backslash that could close the quotes `mailFromLine` puts round it. Angle
  // brackets too: an address belongs in MAIL_FROM, and one typed here would
  // read as a second one.
  .refine((name) => !/[\u0000-\u001f\u007f"\\<>]/.test(name), {
    message: "A name only — no quotes, angle brackets, backslashes or line breaks. The address stays in MAIL_FROM.",
  });

/**
 * One of a list that lives in code — the languages, the themes, the slicers —
 * refused by name otherwise, with the list, as an unknown import source is.
 */
function oneOf<T extends string>(choices: readonly T[], what: string) {
  return z.string().transform((raw, ctx): T => {
    const value = raw.trim();
    if ((choices as readonly string[]).includes(value)) return value as T;
    ctx.addIssue({
      code: "custom",
      message: `"${raw}" is not ${what} this version has. Known: ${choices.join(", ")}.`,
    });
    return z.NEVER;
  });
}

/**
 * A select on the form. Its first option, the built-in default's, sends an
 * empty value, which is "back to the default" (null) — so an untouched form
 * changes nothing and records nothing, and the row never holds a value that
 * only restates the default.
 */
const choiceFromForm =
  (name: SettingKey) =>
  (form: FormData): string | null | undefined => {
    if (!form.has(name)) return undefined;
    const value = String(form.get(name) ?? "").trim();
    return value === "" ? null : value;
  };

const spec = <K extends SettingKey, Value>(s: Spec<K, Value>) => s;

export const SETTINGS = {
  importSources: spec<"importSources", ImportSource[]>({
    label: "Import from a link",
    env: { name: "IMPORT_SOURCES", read: (env) => said(env, "IMPORT_SOURCES") },
    schema: importSourcesSchema,
    store: (sources) => sources.join(","),
    // Off. Fetching from a site the operator may never have heard of is not
    // something an upgrade should start doing.
    fallback: () => [],
    fromForm: (form) => {
      // A ticked box sends its value and an unticked one sends nothing, so
      // the page adds an empty field of the same name to say "this form
      // carried the list": all boxes clear is then "off", not "not asked".
      if (!form.has("importSources")) return undefined;
      const names = form.getAll("importSources").map((v) => String(v).trim()).filter(Boolean);
      return names.length > 0 ? names.join(",") : null;
    },
  }),

  mailFromName: spec<"mailFromName", string | null>({
    label: "Sender name",
    // Only a MAIL_FROM with a name in it says anything about the name. A bare
    // address leaves the name to the owner. Whatever it says goes to the
    // transport as written, as it always has, so it is shown, not judged.
    env: {
      name: "MAIL_FROM",
      read: (env) => {
        const raw = said(env, "MAIL_FROM");
        return raw === undefined ? undefined : parseMailFrom(raw).name;
      },
      asWritten: true,
    },
    schema: mailFromNameSchema,
    store: (name) => name ?? "",
    // The built-in name when MAIL_FROM is unset, none when it is a bare
    // address — each exactly what was sent before.
    fallback: (env) => (said(env, "MAIL_FROM") === undefined ? DEFAULT_NAME : null),
    fromForm: (form) => {
      if (!form.has("mailFromName")) return undefined;
      const name = String(form.get("mailFromName") ?? "").trim();
      return name === "" ? null : name;
    },
  }),

  // The three defaults for everyone who has not chosen on /me. No variable
  // sets them: they are about how the app looks and speaks, which is the
  // owner's call and not the operator's, and none of them changes what the
  // server does. Each fallback is what everyone got before there was a choice.

  defaultLocale: spec<"defaultLocale", Locale>({
    label: "Default language",
    schema: oneOf(LOCALES, "a language"),
    store: (locale) => locale,
    // Only for a browser that asks for no language the app speaks: one that
    // asks for English or French gets it, before this (src/i18n/locales.ts).
    fallback: () => DEFAULT_LOCALE,
    fromForm: choiceFromForm("defaultLocale"),
  }),

  defaultTheme: spec<"defaultTheme", ThemeChoice>({
    label: "Default theme",
    schema: oneOf(THEME_CHOICES, "a theme"),
    store: (theme) => theme,
    fallback: () => DEFAULT_THEME,
    fromForm: choiceFromForm("defaultTheme"),
  }),

  defaultSlicer: spec<"defaultSlicer", SlicerId>({
    label: "Default slicer",
    schema: oneOf(SLICER_IDS, "a slicer"),
    store: (slicer) => slicer,
    // It names the button and nothing else; the helper on each machine
    // decides what opens (src/lib/slicers.ts).
    fallback: () => DEFAULT_SLICER,
    fromForm: choiceFromForm("defaultSlicer"),
  }),
  // `any` only because each entry has its own value type; `spec<K, Value>`
  // above has already checked every entry against its own.
} satisfies { [K in SettingKey]: Spec<K, any> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

type ValueOf<S> = S extends Spec<SettingKey, infer V> ? V : never;
export type SettingValues = { [K in SettingKey]: ValueOf<(typeof SETTINGS)[K]> };

/**
 * The one schema: every setting, as the column holds it, to the value the app
 * uses. Built from the registry so that the two cannot list different things.
 */
export const SettingsSchema = z.object(
  Object.fromEntries(SETTING_KEYS.map((key) => [key, SETTINGS[key].schema])) as {
    [K in SettingKey]: (typeof SETTINGS)[K]["schema"];
  },
);

// ---------------------------------------------------------------------------
// Resolving: environment, then the row, then the default
// ---------------------------------------------------------------------------

export type Resolved<V> = {
  value: V;
  /** Where the value came from. `env` is a locked field. */
  source: "env" | "saved" | "default";
  /** The variable that overrides this setting, whether or not it is set. */
  envName?: string;
  /** What the row holds, as it holds it — kept even when the environment wins. */
  stored: string | null;
  /**
   * Set when the text the value comes from does not validate. `value` is then
   * the fallback, for the page to show; the app itself refuses to use it.
   */
  problem?: string;
};

export type ResolvedSettings = { [K in SettingKey]: Resolved<SettingValues[K]> };

/**
 * Pure: the row (or its absence) and an environment, to what the app uses and
 * why. The environment is a parameter so the rules can be tested without
 * restarting anything — the same reason `ipSource` takes its raw value.
 */
export function resolveSettings(row: Partial<Row> | null, env: Env): ResolvedSettings {
  const out = {} as Record<SettingKey, Resolved<unknown>>;
  for (const key of SETTING_KEYS) {
    const s = SETTINGS[key] as unknown as Spec<SettingKey, unknown>;
    const stored = (row?.[key] ?? null) as string | null;
    const pinned = s.env?.read(env);
    const base = { envName: s.env?.name, stored };

    const text = pinned ?? stored;
    if (text === null) {
      out[key] = { ...base, value: s.fallback(env), source: "default" };
      continue;
    }
    const source = pinned !== undefined ? "env" : "saved";
    if (source === "env" && s.env?.asWritten) {
      out[key] = { ...base, value: text, source };
      continue;
    }
    const parsed = s.schema.safeParse(text);
    out[key] = parsed.success
      ? { ...base, value: parsed.data, source }
      : {
          ...base,
          value: s.fallback(env),
          source,
          problem:
            source === "env"
              ? `${s.env!.name}: ${parsed.error.issues[0]?.message}`
              : `${parsed.error.issues[0]?.message} Change it at /admin/settings.`,
        };
  }
  return out as ResolvedSettings;
}

/**
 * A submitted form, to the columns it changes — or the reason it cannot.
 *
 * The value is checked before whether it may be changed here, so a refusal
 * always says what was wrong with what was sent; a field the environment
 * locks is then refused by naming the variable, never quietly dropped. The
 * page does not render a locked field as an input at all, so only a crafted
 * request reaches that second refusal — which is the request it is for.
 */
export function parseSettingsForm(
  form: FormData,
  env: Env,
): { changes: Partial<Record<SettingKey, string | null>> } | { problem: string } {
  const submitted: Partial<Record<SettingKey, string | null>> = {};
  for (const key of SETTING_KEYS) {
    const value = SETTINGS[key].fromForm(form);
    if (value !== undefined) submitted[key] = value;
  }

  const toCheck = Object.fromEntries(Object.entries(submitted).filter(([, v]) => v !== null));
  const parsed = SettingsSchema.partial().safeParse(toCheck);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const key = issue.path[0] as SettingKey;
    return { problem: `${SETTINGS[key]?.label ?? String(key)}: ${issue.message}` };
  }

  const changes: Partial<Record<SettingKey, string | null>> = {};
  for (const key of Object.keys(submitted) as SettingKey[]) {
    const s = SETTINGS[key] as unknown as Spec<SettingKey, unknown>;
    if (s.env && s.env.read(env) !== undefined) {
      return {
        problem: `${s.label} is set by ${s.env.name} in the environment, which wins. Change it there.`,
      };
    }
    changes[key] =
      submitted[key] === null ? null : (s.store((parsed.data as Record<string, unknown>)[key]) as string);
  }
  return { changes };
}

// ---------------------------------------------------------------------------
// Reads, for every request that needs one
// ---------------------------------------------------------------------------

/** The one row, if anybody has saved. */
export function readSettingsRow(): Promise<InstanceSettings | null> {
  return db.instanceSettings.findUnique({ where: { id: 1 } });
}

/** Every setting, resolved against this process's environment. */
export async function currentSettings(): Promise<ResolvedSettings> {
  return resolveSettings(await readSettingsRow(), process.env);
}

/**
 * The import sources switched on, from the environment or the page.
 *
 * Throws by name when the text it would use is not valid, as `enabledSources`
 * always has: a list that names a source this version does not have is an
 * error to read, not "off".
 */
export async function importSources(): Promise<ImportSource[]> {
  const { importSources: setting } = await currentSettings();
  if (setting.problem) throw new Error(setting.problem);
  return setting.value;
}

/** The `From` line, as `sendMail` uses it. */
export async function currentMailFrom(): Promise<string> {
  const { mailFromName: setting } = await currentSettings();
  if (setting.problem) throw new Error(setting.problem);
  return mailFromLine(process.env, setting.source === "saved" ? setting.value : null);
}
