/**
 * What an avatar may be, in one place.
 *
 * An avatar is stored inline in SQLite — a data URL, so a story export stays a
 * single self-contained file — and it is rendered in an `<img src>`, which means a
 * value that is not a URL is not "an avatar the browser cannot show": it is a
 * **request**. Bare base64 makes the browser treat 123 kB of JPEG as a relative
 * path, ask the server for it, and fail with a 431 because the path is longer than
 * any header limit. The card then falls back to initials, and a character the
 * writer knows perfectly well looks like it is missing.
 *
 * That happened: the app's own portrait picker returned bare base64 and stored it,
 * so every portrait set through the editor was broken while imported ones were fine.
 * This module is the fix's single owner — the server's write paths, the card reader
 * and the repair script all call `normalizeAvatar`, so "what an avatar is" cannot
 * drift between them.
 *
 * ## Why the server sniffs the bytes
 *
 * A bare base64 blob has no type in it, and guessing from the characters is not
 * possible. The bytes do carry the type, though, so `sniffImageType` reads the magic
 * bytes and the repair is exact rather than a hopeful `image/png`. When the bytes
 * are not a recognised image, the value is dropped instead of repaired — a renderer
 * cannot use it, and storing it would only reproduce the 431 somewhere else.
 */

/** Types Reepi will render back. Anything else is not a portrait. */
export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif';

/**
 * Portraits live inside the database and travel in every bundle, so they are capped.
 * Mirrored on the client (`MAX_AVATAR_BYTES` in the portrait control) so the writer
 * is told before the upload rather than after it.
 */
export const MAX_AVATAR_BYTES = 512 * 1024;

/** A data URL for text that only ever needs to be *recognised*, never rebuilt. */
const DATA_URL = /^data:(image\/[a-z0-9.+-]+);base64,/i;

/** `none` is a documented value in the card format, meaning "no portrait". */
const NONE = /^(none|null|undefined)$/i;

function decodeBase64(value: string): Buffer | null {
  const compact = value.replace(/\s+/g, '');
  if (compact.length === 0 || !/^[A-Za-z0-9+/]+=*$/.test(compact)) return null;
  try {
    const buffer = Buffer.from(compact, 'base64');
    /* `Buffer.from` never throws on bad base64 — it silently skips what it cannot
       read — so the length is the check that the value was really base64. */
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

/** The magic bytes of the formats this app will show. */
export function sniffImageType(bytes: Uint8Array): ImageMime | null {
  const at = (offset: number, ...values: number[]): boolean =>
    values.every((value, index) => bytes[offset + index] === value);

  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  /* RIFF....WEBP */
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  /* ISO-BMFF: ....ftyp{avif|avis} */
  if (at(4, 0x66, 0x74, 0x79, 0x70) && (at(8, 0x61, 0x76, 0x69, 0x66) || at(8, 0x61, 0x76, 0x69, 0x73))) {
    return 'image/avif';
  }
  return null;
}

/**
 * Whether a stored value is something a browser can render.
 *
 * Remote URLs are allowed — a card imported from the wider internet may point at
 * one — but nothing else is: not a bare path, not a `javascript:` URL, and not raw
 * base64.
 */
export function isRenderableAvatar(value: string): boolean {
  if (DATA_URL.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return true;
  return false;
}

export type AvatarVerdict =
  | { ok: true; value: string | null; repaired: boolean; note?: string }
  | { ok: false; reason: string };

/**
 * The one reading of an avatar field.
 *
 * - `null` / empty / `none` → `null`, the honest "no portrait".
 * - a data URL or an http(s) URL → kept as it is.
 * - **bare base64** → repaired into a data URL of the sniffed type. This is the
 *   shape the editor used to write, so it is a state this app really produced.
 * - anything else, or base64 that is not a recognised image → refused, with the
 *   reason, so a caller can reject the write rather than store a broken portrait.
 */
export function normalizeAvatar(raw: unknown): AvatarVerdict {
  if (raw === null || raw === undefined) return { ok: true, value: null, repaired: false };
  if (typeof raw !== 'string') return { ok: false, reason: 'an avatar must be a string, a data URL or null' };

  const value = raw.trim();
  if (value === '' || NONE.test(value)) return { ok: true, value: null, repaired: false };
  if (DATA_URL.test(value)) return { ok: true, value, repaired: false };
  if (/^https?:\/\//i.test(value)) return { ok: true, value, repaired: false };

  const bytes = decodeBase64(value);
  if (!bytes) return { ok: false, reason: 'an avatar must be a data URL, an http(s) URL, or base64 image bytes' };

  const type = sniffImageType(bytes);
  if (!type) {
    return {
      ok: false,
      reason: 'that value is neither a URL nor a recognised image — a portrait must be a data URL or an http(s) URL',
    };
  }
  return {
    ok: true,
    value: `data:${type};base64,${value}`,
    repaired: true,
    note: `prefixless base64 ${type}`,
  };
}
