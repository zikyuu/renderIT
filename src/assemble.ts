import { readFileSync } from "fs";
import { PNG } from "pngjs";
import { z } from "zod";
import { PageSchema, Section } from "./schema";
import { detectText } from "./ocr-detect";
import { detectImageRegions } from "./colour_variance-detect";

type Page = z.infer<typeof PageSchema>;
type RGB = [number, number, number];

const EXCLUDE_CONFIDENCE = 70;          // text this sure of is never a photo candidate
const MIN_TEXT_CONFIDENCE = 50;         // below this, OCR output is treated as noise
const OVERLAY_TEXT_CONFIDENCE = 80;     // text landing on a photo must clear a higher bar (photo texture produces OCR noise)
const MIN_BAND_FRACTION = 0.015;        // bands thinner than 1.5% of page height are merged into a neighbour
const ROW_COLOUR_JUMP = 25;            // RGB distance that counts as "the background changed"
const ROW_PERSIST = 8;                  // ...and it has to stay changed for this many rows
const PHOTO_ROW_UNIQUE_COLOURS = 40;    // a row with fewer distinct colours than this is flat, not photo

interface Band {
  y0: number; // inclusive, pixels
  y1: number; // exclusive, pixels
  kind: "flat" | "photo";
  colour?: RGB;
  photoX?: { x0: number; x1: number };
}

const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const clampUnit = (v: number) => Math.max(1, Math.min(100, Math.round(v)));

// most common (quantised) colour of every row - the row's "background"
function rowBackgrounds(png: PNG): RGB[] {
  const { width, height, data } = png;
  const rows: RGB[] = [];
  for (let y = 0; y < height; y++) {
    const sums = new Map<number, { n: number; r: number; g: number; b: number }>();
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const s = sums.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      s.n++; s.r += data[i]; s.g += data[i + 1]; s.b += data[i + 2];
      sums.set(k, s);
    }
    const top = [...sums.values()].sort((a, b) => b.n - a.n)[0];
    rows.push([top.r / top.n, top.g / top.n, top.b / top.n]);
  }
  return rows;
}

function medianColour(rows: RGB[], y0: number, y1: number): RGB {
  const med = (ch: number) => {
    const v = rows.slice(y0, y1).map((c) => c[ch]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  return [med(0), med(1), med(2)];
}

// the colour-diversity detector works in 50px blocks, so its region edges are
// only accurate to about a block. Scanning row by row for real photo texture
// snaps the top/bottom edge to the actual photo.
function refinePhotoRows(png: PNG, x0: number, x1: number, y0: number, y1: number): [number, number] {
  const { width, data } = png;
  const isPhotoRow = (y: number) => {
    const seen = new Set<number>();
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      seen.add(((data[i] >> 5) << 10) | ((data[i + 1] >> 5) << 5) | (data[i + 2] >> 5));
    }
    return seen.size >= PHOTO_ROW_UNIQUE_COLOURS;
  };
  let top = y0;
  while (top < y1 && !isPhotoRow(top)) top++;
  let bottom = y1 - 1;
  while (bottom > top && !isPhotoRow(bottom)) bottom--;
  return [top, bottom + 1];
}

// split a run of non-photo rows wherever the background colour changes and stays changed
function splitByBackground(rows: RGB[], y0: number, y1: number, minRows: number): Band[] {
  if (y1 <= y0) return [];
  const cuts = [y0];
  let ref = rows[y0];
  for (let y = y0 + 1; y < y1; y++) {
    if (dist(rows[y], ref) <= ROW_COLOUR_JUMP || y - cuts[cuts.length - 1] < minRows) continue;
    const end = Math.min(y + ROW_PERSIST, y1);
    let persists = true;
    for (let k = y; k < end; k++) if (dist(rows[k], ref) <= ROW_COLOUR_JUMP || dist(rows[k], rows[y]) > ROW_COLOUR_JUMP) persists = false;
    if (persists) { cuts.push(y); ref = rows[y]; }
  }
  cuts.push(y1);

  const bands: Band[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1];
    if (b - a < minRows && bands.length > 0) { bands[bands.length - 1].y1 = b; continue; } // too thin: absorb into previous band
    bands.push({ y0: a, y1: b, kind: "flat", colour: medianColour(rows, a, b) });
  }
  return bands;
}

export async function assemblePage(imagePath: string): Promise<{ page: Page; width: number; height: number; bands: Band[] }> {
  const png = PNG.sync.read(readFileSync(imagePath));
  const { width, height } = png;
  const minRows = Math.round(height * MIN_BAND_FRACTION);

  const text = await detectText(imagePath);
  const confident = text.filter((t) => t.confidence >= EXCLUDE_CONFIDENCE);
  const photoRegions = await detectImageRegions(imagePath, confident);

  const rows = rowBackgrounds(png);

  const bands: Band[] = [];
  let cursor = 0;
  for (const region of photoRegions.sort((a, b) => a.y - b.y)) {
    const rx0 = Math.round((region.x / 100) * width);
    const rx1 = Math.round(((region.x + region.width) / 100) * width);
    const [py0, py1] = refinePhotoRows(
      png, rx0, rx1,
      Math.round((region.y / 100) * height),
      Math.round(((region.y + region.height) / 100) * height)
    );
    bands.push(...splitByBackground(rows, cursor, py0, minRows));
    bands.push({ y0: py0, y1: py1, kind: "photo", photoX: { x0: rx0, x1: rx1 } });
    cursor = py1;
  }
  bands.push(...splitByBackground(rows, cursor, height, minRows));

  // slivers left at a seam between the photo and its neighbours get absorbed
  for (let i = bands.length - 1; i >= 0; i--) {
    if (bands[i].y1 - bands[i].y0 >= minRows || bands.length === 1) continue;
    if (i > 0) bands[i - 1].y1 = bands[i].y1;
    else bands[i + 1].y0 = bands[i].y0;
    bands.splice(i, 1);
  }

  // assign each surviving text line to the band holding its vertical centre
  const kept = text.filter((t) => t.confidence >= MIN_TEXT_CONFIDENCE);
  const perBand: Band[] = bands;
  const textByBand = new Map<Band, typeof kept>();
  for (const t of kept) {
    const centreY = ((t.y + t.height / 2) / 100) * height;
    const band = perBand.find((b) => centreY >= b.y0 && centreY < b.y1);
    if (!band) continue;
    if (band.kind === "photo" && t.confidence < OVERLAY_TEXT_CONFIDENCE) continue;
    textByBand.set(band, [...(textByBand.get(band) ?? []), t]);
  }

  const columns: Section[] = bands.map((band) => {
    const bandH = band.y1 - band.y0;
    const base = { span: 100, height: clampUnit((bandH / height) * 100) };

    const textElements = (textByBand.get(band) ?? []).map((t) => ({
      text: t.text,
      fontSize: t.fontSize,
      x: clampUnit(t.x),
      y: clampUnit((((t.y / 100) * height - band.y0) / bandH) * 100),
    }));

    if (band.kind === "photo") {
      const imgX = clampUnit((band.photoX!.x0 / width) * 100);
      return {
        type: "rectangle" as const,
        ...base,
        textElements,
        imageRegions: [{
          x: imgX,
          y: 1,
          width: Math.min(clampUnit(((band.photoX!.x1 - band.photoX!.x0) / width) * 100), 100 - imgX),
          height: 99,
        }],
      };
    }
    return { type: "rectangle" as const, ...base, backgroundColor: toHex(band.colour!), textElements };
  });

  const page: Page = {
    gap: 0,
    sections: [{ type: "grid", direction: "column", span: 100, height: 100, gap: 0, columns }],
  };
  return { page, width, height, bands };
}
