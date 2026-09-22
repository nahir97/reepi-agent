import { createHash, randomUUID } from 'node:crypto';

/** Primary keys: UUIDv4, so imports from anywhere can merge without collisions. */
export function newId(): string {
  return randomUUID();
}

/** Stable, short content hash used for prompt fingerprints and block identity. */
export function hashContent(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\u0000');
  }
  return hash.digest('hex').slice(0, 16);
}

/** Trigger keys are stored comma-separated; normalise on write. */
export function parseKeys(keys: string): string[] {
  return keys
    .split(',')
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

export function serialiseKeys(keys: readonly string[]): string {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))].join(', ');
}
