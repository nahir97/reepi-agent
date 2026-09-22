/**
 * An avatar.
 *
 * Falls back to initials in the display face when there is no image, or when the
 * image fails to load — a broken card import should never leave a hole in the
 * transcript. The box is a fixed circle either way, so nothing shifts when a
 * picture finally arrives.
 *
 * Avatars are decoration: their content is always carried by the speaker's name
 * in the adjacent label, so the image itself is `aria-hidden`.
 */

import { useEffect, useState } from 'react';

export type AvatarProps = {
  name: string;
  src?: string | null;
  /** `sm` for inline rows, `md` for bubbles, `lg` for editors. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

/** First letter of each of the first two words: "Lord Asper" → "LA". */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function Avatar({ name, src, size = 'md', className = '' }: AvatarProps) {
  const [broken, setBroken] = useState(false);

  // A new source deserves a fresh attempt, even if the last one 404'd.
  useEffect(() => setBroken(false), [src]);

  const sizeClass = size === 'sm' ? 'avatar-sm' : size === 'lg' ? 'avatar-lg' : '';

  return (
    <span className={`avatar ${sizeClass} ${className}`} title={name} aria-hidden="true">
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
