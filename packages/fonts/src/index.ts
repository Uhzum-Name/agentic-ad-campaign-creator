import { brotliDecompressSync, inflateSync } from "node:zlib";

/*
 * Reads the identifying details out of a font file — family name, weight and
 * style — so an uploaded brand font can be matched to the font names used in
 * designs without the uploader typing them in. Supports TrueType (.ttf),
 * OpenType/CFF (.otf), WOFF and WOFF2. Only the `name` and `OS/2` tables are read.
 */

export type FontFormat = "truetype" | "opentype" | "woff" | "woff2";

export interface FontInfo {
  format: FontFormat;
  /** The family designers pick in Figma: typographic family (name 16) if present, else name 1. */
  family: string;
  /** e.g. "Bold Italic". */
  subfamily: string;
  /** 100–900, from OS/2 usWeightClass. */
  weight: number;
  style: "normal" | "italic";
  /** Full font name (name 4), for display. */
  fullName?: string;
}

export const FONT_CONTENT_TYPES: Record<FontFormat, string> = {
  truetype: "font/ttf",
  opentype: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
};
export const FONT_EXTENSIONS: Record<FontFormat, string> = { truetype: "ttf", opentype: "otf", woff: "woff", woff2: "woff2" };

export class FontParseError extends Error {}

const tag = (b: Buffer, at: number) => b.toString("latin1", at, at + 4);

export function detectFontFormat(data: Buffer): FontFormat | undefined {
  if (data.length < 12) return undefined;
  const t = tag(data, 0);
  if (t === "wOF2") return "woff2";
  if (t === "wOFF") return "woff";
  if (t === "OTTO") return "opentype";
  if (data.readUInt32BE(0) === 0x00010000 || t === "true") return "truetype";
  return undefined;
}

/** Table tag → raw (decompressed) table bytes, for the tables we need. */
type Tables = Map<string, Buffer>;
const WANTED = new Set(["name", "OS/2"]);

function sfntTables(data: Buffer): Tables {
  const tables: Tables = new Map();
  const count = data.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const rec = 12 + i * 16;
    const t = tag(data, rec);
    const offset = data.readUInt32BE(rec + 8);
    const length = data.readUInt32BE(rec + 12);
    if (WANTED.has(t)) tables.set(t, data.subarray(offset, offset + length));
  }
  return tables;
}

function woffTables(data: Buffer): Tables {
  const tables: Tables = new Map();
  const count = data.readUInt16BE(12);
  for (let i = 0; i < count; i++) {
    const rec = 44 + i * 20;
    const t = tag(data, rec);
    if (!WANTED.has(t)) continue;
    const offset = data.readUInt32BE(rec + 4);
    const compLength = data.readUInt32BE(rec + 8);
    const origLength = data.readUInt32BE(rec + 12);
    const raw = data.subarray(offset, offset + compLength);
    tables.set(t, compLength < origLength ? inflateSync(raw) : raw);
  }
  return tables;
}

// WOFF2 spec §4.1: the 63 most common tags, referenced by index.
const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function woff2Tables(data: Buffer): Tables {
  const count = data.readUInt16BE(12);
  const totalCompressedSize = data.readUInt32BE(20);
  let p = 48;
  const readBase128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = data[p++]!;
      if (i === 0 && byte === 0x80) throw new FontParseError("Invalid WOFF2 number");
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new FontParseError("Invalid WOFF2 number");
  };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < count; i++) {
    const flags = data[p++]!;
    const index = flags & 0x3f;
    const t = index === 63 ? tag(data, (p += 4) - 4) : WOFF2_KNOWN_TAGS[index];
    if (!t) throw new FontParseError("Invalid WOFF2 table tag");
    const origLength = readBase128();
    const version = (flags >> 6) & 3;
    // glyf/loca are transformed unless version 3; any other table is transformed unless version 0.
    const transformed = t === "glyf" || t === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? readBase128() : origLength;
    entries.push({ tag: t, length });
  }
  if (data.readUInt32BE(4) === 0x74746366) throw new FontParseError("Font collections are not supported; upload individual font files");
  const stream = brotliDecompressSync(data.subarray(p, p + totalCompressedSize));
  const tables: Tables = new Map();
  let offset = 0;
  for (const e of entries) {
    if (WANTED.has(e.tag)) tables.set(e.tag, stream.subarray(offset, offset + e.length));
    offset += e.length;
  }
  return tables;
}

function readNames(name: Buffer): Map<number, string> {
  const count = name.readUInt16BE(2);
  const storage = name.readUInt16BE(4);
  const best = new Map<number, { rank: number; value: string }>();
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const platform = name.readUInt16BE(r);
    const encoding = name.readUInt16BE(r + 2);
    const language = name.readUInt16BE(r + 4);
    const id = name.readUInt16BE(r + 6);
    const length = name.readUInt16BE(r + 8);
    const offset = storage + name.readUInt16BE(r + 10);
    const raw = name.subarray(offset, offset + length);
    let value: string;
    let rank: number;
    if (platform === 3 || platform === 0) {
      // UTF-16BE
      const chars: number[] = [];
      for (let j = 0; j + 1 < raw.length; j += 2) chars.push(raw.readUInt16BE(j));
      value = String.fromCharCode(...chars);
      rank = platform === 3 && encoding === 1 && language === 0x409 ? 0 : platform === 3 ? 1 : 2;
    } else if (platform === 1 && encoding === 0) {
      value = raw.toString("latin1");
      rank = 3;
    } else continue;
    const prev = best.get(id);
    if (!prev || rank < prev.rank) best.set(id, { rank, value });
  }
  return new Map([...best].map(([id, v]) => [id, v.value.replace(/\0/g, "").trim()]));
}

export function parseFont(data: Buffer): FontInfo {
  const format = detectFontFormat(data);
  if (!format) throw new FontParseError("This is not a font file. Upload a .woff2, .woff, .otf or .ttf file.");
  let tables: Tables;
  try {
    tables = format === "woff2" ? woff2Tables(data) : format === "woff" ? woffTables(data) : sfntTables(data);
  } catch (err) {
    throw err instanceof FontParseError ? err : new FontParseError("The font file is damaged or uses an unsupported layout.");
  }
  const name = tables.get("name");
  if (!name || name.length < 6) throw new FontParseError("The font file has no name table, so its family name cannot be read.");
  let names: Map<number, string>;
  try {
    names = readNames(name);
  } catch {
    throw new FontParseError("The font's name table could not be read.");
  }
  const family = names.get(16) || names.get(1);
  if (!family) throw new FontParseError("The font file does not state a family name.");
  const subfamily = names.get(17) || names.get(2) || "Regular";

  const os2 = tables.get("OS/2");
  let weight = 400;
  let italic = /italic|oblique/i.test(subfamily);
  if (os2 && os2.length >= 64) {
    const w = os2.readUInt16BE(4);
    if (w >= 1 && w <= 1000) weight = w;
    italic = (os2.readUInt16BE(62) & 0x01) !== 0 || italic;
  }
  // Clamp to the CSS 100–900 range in steps the browser understands.
  weight = Math.min(900, Math.max(100, Math.round(weight / 100) * 100));
  return { format, family, subfamily, weight, style: italic ? "italic" : "normal", ...(names.get(4) ? { fullName: names.get(4) } : {}) };
}
