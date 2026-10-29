-- When the first-run setup at /admin/setup was finished or skipped (#106).
--
-- While it is null, the owner's landing page sends them to the setup. A fresh
-- install must start there; an instance that is already in use must never be
-- sent back through it — so the column is filled in here, once, for every
-- instance that has been used, and left null only for one that has not.
--
-- What "used" means is decided by what a fresh install cannot have when this
-- runs. The migrator runs `prisma migrate deploy` before the seed, so on a
-- fresh install this runs against an empty database. On an existing one the
-- seed has run at least once, so the owner's row and the default benefits
-- exist whether or not anybody ever signed in — and neither counts: an
-- instance whose owner was seeded but never opened the bootstrap link has
-- nobody who has seen the app, and the setup is exactly for them. Anything
-- beyond that does count:
--
--   - a password, anyone's. Nobody signs in without one — a passkey is
--     enrolled from a session, and the seed never sets one. The owner having
--     set theirs is the plainest sign the instance has started; it is also
--     the line issue #106 draws ("starts where the bootstrap ends").
--   - a passkey, an account other than the owner's, an invitation or a
--     ticket: none can exist without somebody having signed in, and each is
--     checked on its own so that a database restored or edited by hand,
--     where the passwords were reset, still counts as used.
--   - an audit event. The seed records none; a sign-in, a completed
--     bootstrap link and every change after it do.
--   - the settings row itself: it exists only once the owner has saved at
--     /admin/settings.
--
-- `verify:setup` runs the statement between the two markers against a
-- database in each of those states, so keep the markers where they are.
--
-- Additive, like the two migrations before it: the deploy wizard rolls back
-- to the previous image when a deploy fails its health check, and it does
-- not undo migrations. That image's client names its columns, has never heard
-- of this one, and reads and writes the settings row exactly as before; a row
-- inserted here holds no setting, which it reads as "every setting at its
-- default", the same as no row.
ALTER TABLE "instanceSettings" ADD COLUMN "setupCompletedAt" TIMESTAMP(3);

-- backfill:begin
INSERT INTO "instanceSettings" ("id", "updatedAt", "setupCompletedAt")
SELECT 1, now(), now()
WHERE EXISTS (SELECT 1 FROM "account" WHERE "password" IS NOT NULL)
   OR EXISTS (SELECT 1 FROM "passkey")
   OR EXISTS (SELECT 1 FROM "user" WHERE "role" IS DISTINCT FROM 'admin')
   OR EXISTS (SELECT 1 FROM "invite")
   OR EXISTS (SELECT 1 FROM "story")
   OR EXISTS (SELECT 1 FROM "auditEvent")
   OR EXISTS (SELECT 1 FROM "instanceSettings")
ON CONFLICT ("id") DO UPDATE SET "setupCompletedAt" = now()
  WHERE "instanceSettings"."setupCompletedAt" IS NULL;
-- backfill:end
