import "server-only";
import { cache } from "react";

import type { Locale } from "@/i18n/locales";
import { currentUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { PREFERENCE_COLUMNS, readPreferences, type Preferences } from "@/lib/preferences";
import { currentSettings } from "@/lib/settings";
import type { SlicerId } from "@/lib/slicers";
import type { ThemeChoice } from "@/lib/theme";

/**
 * What the person reading this page chose, and what the instance says for
 * everyone who did not — the inputs `themeForRequest`, `slicerForRequest` and
 * src/i18n/request.ts hand to their resolvers.
 *
 * `cache`d for the request: the root layout asks for the theme, next-intl for
 * the language and a ticket page for the slicer, and between them that is one
 * session read, one settings row and one user row, not three of each. It is
 * React's per-request cache, not a copy kept between requests, so a save on
 * /me or /admin/settings is in effect from the next page — the settings rule
 * ("read on every use", src/lib/settings.ts) holds.
 *
 * `person` is null when nobody is signed in: the sign-in page, a reset link.
 *
 * An instance default the owner saved and this version no longer knows reads
 * as the built-in default here (`resolveSettings` gives the fallback with a
 * `problem`), quietly. Unlike the import list, a wrong theme decides nothing
 * about what the server does, and the settings page is where the problem is
 * shown, to the one person who can fix it.
 */
export const viewerPreferences = cache(
  async (): Promise<{
    person: Preferences | null;
    instance: { locale: Locale; theme: ThemeChoice; slicer: SlicerId };
  }> => {
    const [user, settings] = await Promise.all([currentUser(), currentSettings()]);
    const row = user
      ? await db.user.findUnique({ where: { id: user.id }, select: PREFERENCE_COLUMNS })
      : null;
    return {
      person: row ? readPreferences(row) : null,
      instance: {
        locale: settings.defaultLocale.value,
        theme: settings.defaultTheme.value,
        slicer: settings.defaultSlicer.value,
      },
    };
  },
);
