-- A person's language, theme and slicer, set on /me, and the instance's
-- defaults for each, set at /admin/settings (#102, #103, #105).
--
-- Six nullable columns and nothing else. Null on a person is "follow the
-- instance", null on the instance is "the built-in default" — English, the
-- diner, PrusaSlicer — which is what the app did before these existed, so an
-- upgraded deployment looks exactly as it did until somebody chooses.
--
-- Additive on purpose: the deploy wizard rolls back to the previous image
-- when a deploy fails its health check, and it does not undo migrations. That
-- image's client names its columns, has never heard of these, and reads and
-- writes users and the settings row exactly as before.
ALTER TABLE "user"
    ADD COLUMN "preferredLocale" TEXT,
    ADD COLUMN "preferredTheme" TEXT,
    ADD COLUMN "preferredSlicer" TEXT;

ALTER TABLE "instanceSettings"
    ADD COLUMN "defaultLocale" TEXT,
    ADD COLUMN "defaultTheme" TEXT,
    ADD COLUMN "defaultSlicer" TEXT;
