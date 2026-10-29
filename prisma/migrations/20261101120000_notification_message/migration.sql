-- A notification's sentence as a message key and its values, beside the
-- English text it has always stored (#103).
--
-- `text` is written once, in English, when the notification is made, so the
-- Activity panel listed English items under a French title. With the key and
-- its values (names, titles, a status) the panel says the sentence in the
-- reader's language, today's and whichever comes next.
--
-- Two nullable columns and nothing else. A row written before them has no key
-- and keeps showing its stored English, exactly as it did; nothing is
-- backfilled, because the English sentence cannot be taken apart again
-- reliably — a title can contain any of the words around it. `text` is still
-- written on every row: it is what the JSON API returns, unchanged.
--
-- Additive on purpose: the deploy wizard rolls back to the previous image
-- when a deploy fails its health check, and it does not undo migrations. That
-- image's client names its columns, has never heard of these, and reads and
-- writes notifications exactly as before.
ALTER TABLE "notification"
    ADD COLUMN "messageKey" TEXT,
    ADD COLUMN "messageValues" JSONB;
