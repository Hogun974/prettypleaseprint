/**
 * A rough, human label for a new passkey, from the browser's User-Agent, so a
 * list of passkeys is readable later. It is stored as the passkey's name and
 * shown back as written, so it stays English, like the rest of what is stored.
 *
 * Shared by /welcome and the first-run setup, the two places a passkey is
 * enrolled.
 */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "This device";
  if (/iPhone|iPad/i.test(userAgent)) return "iPhone or iPad";
  if (/Android/i.test(userAgent)) return "Android device";
  if (/Macintosh/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows PC";
  if (/Linux/i.test(userAgent)) return "Linux machine";
  return "This device";
}
