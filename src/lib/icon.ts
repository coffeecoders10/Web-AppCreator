/**
 * Launcher icon generation, entirely local (sharp / libvips). A PNG upload is validated and scaled
 * to every Android density; with no upload a monogram icon is drawn from the app name.
 */
import sharp from "sharp";
import { UserInputError } from "./file-utils";

export const MAX_ICON_BYTES = 2 * 1024 * 1024;
const MIN_ICON_SIZE = 192;
const MAX_ICON_SIZE = 4096;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A file to write under app/src/main/res/. */
export interface GeneratedFile {
  path: string;
  content: Buffer | string;
}

const LEGACY_SIZES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 } as const;
const ADAPTIVE_SIZES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 } as const;

/** Throws UserInputError unless the buffer is a square PNG of a sensible size. */
export async function validateIcon(buffer: Buffer): Promise<void> {
  if (buffer.length === 0) throw new UserInputError("The icon file is empty.", 400, { icon: "The icon file is empty." });
  if (buffer.length > MAX_ICON_BYTES) {
    throw new UserInputError("The icon must be 2 MB or smaller.", 413, { icon: "The icon must be 2 MB or smaller." });
  }
  const fail = (message: string) => new UserInputError(message, 400, { icon: message });
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw fail("The icon must be a PNG image.");

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_ICON_SIZE * MAX_ICON_SIZE, failOn: "error" }).metadata();
  } catch {
    throw fail("The icon could not be read as a valid PNG image.");
  }
  const { width = 0, height = 0 } = meta;
  if (meta.format !== "png") throw fail("The icon must be a PNG image.");
  if (width !== height) throw fail(`The icon must be square (yours is ${width}×${height}).`);
  if (width < MIN_ICON_SIZE) throw fail(`The icon must be at least ${MIN_ICON_SIZE}×${MIN_ICON_SIZE} pixels.`);
  if (width > MAX_ICON_SIZE) throw fail(`The icon must be at most ${MAX_ICON_SIZE}×${MAX_ICON_SIZE} pixels.`);
}

/**
 * Builds every launcher icon resource: legacy square and round PNGs for each density, adaptive
 * icon foregrounds, the adaptive background colour and the adaptive-icon XML.
 */
export async function buildLauncherIcons(
  upload: Buffer | null,
  appName: string,
  backgroundOverride: string | null = null,
): Promise<GeneratedFile[]> {
  const source = upload
    ? { png: await normalizePng(upload), background: backgroundOverride ?? (await cornerColor(upload)) }
    : await monogram(appName);

  const files: GeneratedFile[] = [];
  const squareMask = roundedMask(0.18);
  const circleMask = roundedMask(0.5);

  for (const [density, size] of Object.entries(LEGACY_SIZES)) {
    let image = sharp(source.png).resize(size, size, { fit: "cover" });
    // A chosen colour also fills transparent areas of the legacy icons.
    if (upload && backgroundOverride) image = image.flatten({ background: backgroundOverride });
    const base = await image.png().toBuffer();
    files.push({ path: `mipmap-${density}/ic_launcher.png`, content: await mask(base, size, squareMask) });
    files.push({ path: `mipmap-${density}/ic_launcher_round.png`, content: await mask(base, size, circleMask) });
  }

  for (const [density, size] of Object.entries(ADAPTIVE_SIZES)) {
    // The adaptive mask shows the centre 72/108 of the canvas. An upload is drawn slightly larger than
    // that window so no background colour rim shows inside the mask; the generated monogram stays
    // inside the 66/108 safe zone.
    const inner = Math.round(size * ((upload ? 76 : 66) / 108));
    const artwork = await sharp(source.png).resize(inner, inner, { fit: "cover" }).png().toBuffer();
    const canvas = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: artwork, gravity: "centre" }])
      .png()
      .toBuffer();
    files.push({ path: `mipmap-${density}/ic_launcher_foreground.png`, content: canvas });
  }

  files.push({
    path: "values/ic_launcher_background.xml",
    content: `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${source.background}</color>\n</resources>\n`,
  });
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/ic_launcher_background" />\n    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n</adaptive-icon>\n`;
  files.push({ path: "mipmap-anydpi-v26/ic_launcher.xml", content: adaptive });
  files.push({ path: "mipmap-anydpi-v26/ic_launcher_round.xml", content: adaptive });
  return files;
}

/** Accepts "#RRGGBB" only; returns it upper-cased, or null when absent. Throws a field error otherwise. */
export function parseIconBackground(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    const message = "The icon background must be a colour like #1A2B3C.";
    throw new UserInputError(message, 400, { iconBackground: message });
  }
  return value.toUpperCase();
}

/** Re-encodes the upload (drops metadata, forces RGBA) so only pixel data reaches the build. */
async function normalizePng(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { limitInputPixels: MAX_ICON_SIZE * MAX_ICON_SIZE })
    .ensureAlpha()
    .png()
    .toBuffer();
}

/** Colour of the top-left pixel flattened onto white, as #RRGGBB. Used as the adaptive background. */
async function cornerColor(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer, { limitInputPixels: MAX_ICON_SIZE * MAX_ICON_SIZE })
    .ensureAlpha()
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = data[3] / 255;
  const channel = (value: number) => Math.round(value * alpha + 255 * (1 - alpha));
  return toHex(channel(data[0]), channel(data[1]), channel(data[2]));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function roundedMask(radiusFraction: number): (size: number) => Buffer {
  return (size) => {
    const r = Math.round(size * radiusFraction);
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/></svg>`,
    );
  };
}

async function mask(image: Buffer, size: number, makeMask: (size: number) => Buffer): Promise<Buffer> {
  return sharp(image).composite([{ input: makeMask(size), blend: "dest-in" }]).png().toBuffer();
}

/** A deterministic colour per app name, so different apps get different default icons. */
function monogramColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  const palette = ["#3B5BDB", "#0C8599", "#2F9E44", "#E8590C", "#C2255C", "#7048E8", "#1971C2", "#5F3DC4"];
  return palette[hash % palette.length];
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
}

/**
 * The bundled generic icon: the app's first letter on a coloured square. If the host has no usable
 * font and no glyph gets drawn, a plain globe glyph is used instead so the icon is never blank.
 */
async function monogram(appName: string): Promise<{ png: Buffer; background: string }> {
  const background = monogramColor(appName);
  const letter = [...appName.trim()].find((c) => /[\p{L}\p{N}]/u.test(c))?.toUpperCase();
  const base = `<rect width="512" height="512" fill="${background}"/>`;
  const wrap = (inner: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${base}${inner}</svg>`);

  const globe =
    `<g fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round">` +
    `<circle cx="256" cy="256" r="130"/><path d="M126 256H386M256 126C206 186 206 326 256 386C306 326 306 186 256 126Z"/></g>`;

  const plain = await sharp(wrap("")).png().toBuffer();
  if (letter) {
    const text = `<text x="256" y="262" font-family="Segoe UI, Helvetica Neue, Helvetica, Arial, DejaVu Sans, sans-serif" font-size="320" font-weight="700" fill="#fff" text-anchor="middle" dominant-baseline="central">${escapeXml(letter)}</text>`;
    const withLetter = await sharp(wrap(text)).png().toBuffer();
    const [a, b] = await Promise.all([sharp(plain).raw().toBuffer(), sharp(withLetter).raw().toBuffer()]);
    if (!a.equals(b)) return { png: withLetter, background };
  }
  return { png: await sharp(wrap(globe)).png().toBuffer(), background };
}
