import { randomBytes } from "node:crypto";

/**
 * Every entity has a prefixed, URL-safe id (e.g. `prj_4kq9...`). The prefix
 * makes ids self-describing in logs, API payloads and agent tool calls.
 */
export const ID_PREFIX = {
  project: "prj",
  campaign: "cmp",
  brief: "brf",
  designDocument: "dsn",
  layer: "lyr",
  creativeDirection: "dir",
  variation: "var",
  variationFormat: "fmt",
  animationSpec: "anm",
  renderedAsset: "ast",
  job: "job",
  recipe: "rcp",
} as const;

export type EntityKind = keyof typeof ID_PREFIX;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, lowercase

export function newId(kind: EntityKind): string {
  const bytes = randomBytes(16);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return `${ID_PREFIX[kind]}_${out}`;
}

export function isId(kind: EntityKind, value: string): boolean {
  return new RegExp(`^${ID_PREFIX[kind]}_[0-9a-hjkmnp-tv-z]{16}$`).test(value);
}
