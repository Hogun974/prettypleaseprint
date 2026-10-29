-- Instance-wide settings the printer owner changes at /admin/settings (#104).
--
-- Nothing is inserted. The app reads a missing row as "every setting at its
-- default", and the defaults are what the app did before this table existed,
-- so an upgraded deployment behaves exactly as it did until the owner saves.
--
-- One row at most, enforced here rather than by convention, the same way
-- user_single_admin makes a second admin impossible: the CHECK pins the only
-- id there can be. Prisma does not model CHECK constraints and leaves this one
-- alone.
--
-- A new table, and nothing else touched, on purpose: the deploy wizard rolls
-- back to the previous image when a deploy fails its health check, and it
-- does not undo migrations. That image's client has never heard of this table
-- and reads and writes everything else exactly as before.
CREATE TABLE "instanceSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "importSources" TEXT,
    "mailFromName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instanceSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "instanceSettings_single_row" CHECK ("id" = 1)
);
