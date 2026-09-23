import { createWorker, Worker } from "tesseract.js";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PNG } from "pngjs";

interface DetectedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  confidence: number;
}

interface Box { x0: number; y0: number; x1: number; y1: number }
type RGB = [number, number, number];

const MIN_HEIGHT_PX = 10;
const MAX_HEIGHT_PX = 100;
const MIN_CONTAINER_CONFIDENCE = 50;

function heightToFontSize(heightPx: number): number {
  const clamped = Math.max(MIN_HEIGHT_PX, Math.min(MAX_HEIGHT_PX, heightPx));
  return Math.round(((clamped - MIN_HEIGHT_PX) / (MAX_HEIGHT_PX - MIN_HEIGHT_PX)) * 99) + 1;
}

function boxesOverlap(a: Box, b: Box): boolean {
  const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return false;
  const smaller = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
  return (ix * iy) / smaller > 0.5;
}

// most common colour in a region, averaged over its quantised bucket
function dominantColours(png: PNG, region: Box, minShare: number, maxCount: number): RGB[] {
  const { width: W, data } = png;
  const sums = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = region.y0; y <= region.y1; y++) {
    for (let x = region.x0; x <= region.x1; x++) {
      const i = (y * W + x) * 4;
      const k = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const s = sums.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
      s.n++; s.r += data[i]; s.g += data[i + 1]; s.b += data[i + 2];
      sums.set(k, s);
      total++;
    }
  }
  return [...sums.values()]
    .filter((s) => s.n / total >= minShare)
    .sort((a, b) => b.n - a.n)
    .slice(0, maxCount)
    .map((s) => [s.r / s.n, s.g / s.n, s.b / s.n] as RGB);
}

// Text inside pills/buttons defeats whole-image OCR: it's a mix of light-on-dark
// and dark-on-light text, and the container outline gets read as characters.
// Finding the containers first (connected blobs of "not-background" pixels with a
// button-like size and shape) lets each one be OCRed on its own.
function findContainers(png: PNG, bg: RGB): Box[] {
  const { width: W, height: H, data } = png;
  const ink = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    ink[p] = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > 60 ? 1 : 0;
  }
  const seen = new Uint8Array(W * H);
  const boxes: Box[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!ink[start] || seen[start]) continue;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const np = ny * W + nx;
          if (ink[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
        }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bh >= 24 && bh <= 110 && bw / bh >= 1.6 && bw / bh <= 10 && bw <= W * 0.4) {
      boxes.push({ x0, y0, x1, y1 });
    }
  }
  return boxes;
}

const CROP_SCALE = 2;
const CROP_PAD = 40;
const CROP_GAIN = 2.5;

// Re-colours a container's interior so its own background is white and anything
// different from it (light or dark text) is black - one polarity for Tesseract.
function renderContainerCrop(png: PNG, b: Box): { path: string; x0: number; y0: number } {
  const { width: W, data } = png;
  const bh = b.y1 - b.y0 + 1;
  const ix = Math.round(bh * 0.3), iy = Math.round(bh * 0.12);
  const inner: Box = { x0: b.x0 + ix, y0: b.y0 + iy, x1: b.x1 - ix, y1: b.y1 - iy };
  const w = inner.x1 - inner.x0 + 1, h = inner.y1 - inner.y0 + 1;
  const bg = dominantColours(png, inner, 0, 1)[0];

  const out = new PNG({ width: w * CROP_SCALE + CROP_PAD * 2, height: h * CROP_SCALE + CROP_PAD * 2 });
  out.data.fill(255);
  for (let y = 0; y < h * CROP_SCALE; y++) {
    for (let x = 0; x < w * CROP_SCALE; x++) {
      const si = ((inner.y0 + ((y / CROP_SCALE) | 0)) * W + (inner.x0 + ((x / CROP_SCALE) | 0))) * 4;
      const d = Math.hypot(data[si] - bg[0], data[si + 1] - bg[1], data[si + 2] - bg[2]);
      const v = 255 - Math.min(255, d * CROP_GAIN);
      const oi = ((y + CROP_PAD) * out.width + (x + CROP_PAD)) * 4;
      out.data[oi] = out.data[oi + 1] = out.data[oi + 2] = v;
    }
  }
  const path = join(tmpdir(), `ocr-container-${b.x0}-${b.y0}.png`);
  writeFileSync(path, PNG.sync.write(out));
  return { path, x0: inner.x0, y0: inner.y0 };
}

function cleanText(text: string): string {
  return text.trim().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

export interface DetectedShape {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  backgroundColor: string;
  borderRadius: number; // % of the shape's own height; 50 = fully pill-shaped
}

const colourDist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// a candidate container's geometry alone is a weak signal - both a stray
// blob of photo texture and a fragment of large heading text can happen to
// have a button-like size/aspect ratio. Confirmed OCR text inside it (the
// same bar used to keep it as text at all) is what tells a real button/pill
// apart from those false positives, so shapes are only ever derived from a
// container that OCR actually read successfully - never from geometry alone.
async function detectConfirmedContainers(
  png: PNG,
  worker: Worker
): Promise<{ container: Box; bg: RGB; text: DetectedText; shape: DetectedShape }[]> {
  const { width: W, height: H } = png;
  const bgs = dominantColours(png, { x0: 0, y0: 0, x1: W - 1, y1: H - 1 }, 0.08, 3);

  const candidates: { box: Box; bg: RGB }[] = [];
  for (const bg of bgs) {
    for (const b of findContainers(png, bg)) {
      if (!candidates.some((c) => boxesOverlap(c.box, b))) candidates.push({ box: b, bg });
    }
  }

  await worker.setParameters({ tessedit_pageseg_mode: "7" as any });
  const found: { container: Box; bg: RGB; text: DetectedText; shape: DetectedShape }[] = [];
  for (const { box: container, bg } of candidates) {
    const crop = renderContainerCrop(png, container);
    const { data } = await worker.recognize(crop.path, {}, { blocks: true });
    unlinkSync(crop.path);

    const lines = ((data as any).blocks ?? []).flatMap((b: any) =>
      (b.paragraphs ?? []).flatMap((p: any) => p.lines ?? [])
    );
    if (lines.length === 0) continue;

    const text = cleanText(lines.map((l: any) => l.text).join(" "));
    const confidence = data.confidence;
    if (text.length < 2 || confidence < MIN_CONTAINER_CONFIDENCE) continue;

    const x0 = Math.min(...lines.map((l: any) => l.bbox.x0));
    const y0 = Math.min(...lines.map((l: any) => l.bbox.y0));
    const x1 = Math.max(...lines.map((l: any) => l.bbox.x1));
    const y1 = Math.max(...lines.map((l: any) => l.bbox.y1));
    const toSrcX = (v: number) => crop.x0 + (v - CROP_PAD) / CROP_SCALE;
    const toSrcY = (v: number) => crop.y0 + (v - CROP_PAD) / CROP_SCALE;
    const heightPx = (y1 - y0) / CROP_SCALE;

    const fill = dominantColours(png, container, 0, 1)[0];
    const bh = container.y1 - container.y0 + 1;
    // sample right at a corner: if it matches the outer background rather
    // than the fill, the corner is cut away by rounding rather than square
    const inset = Math.max(2, Math.round(bh * 0.18));
    const corner = dominantColours(
      png,
      { x0: container.x0, y0: container.y0, x1: container.x0 + inset, y1: container.y0 + inset },
      0, 1
    )[0];
    const isRounded = colourDist(corner, bg) < colourDist(corner, fill);

    found.push({
      container,
      bg,
      text: {
        text,
        x: (toSrcX(x0) / W) * 100,
        y: (toSrcY(y0) / H) * 100,
        width: ((x1 - x0) / CROP_SCALE / W) * 100,
        height: (heightPx / H) * 100,
        fontSize: heightToFontSize(heightPx),
        confidence,
      },
      shape: {
        x0: container.x0, y0: container.y0, x1: container.x1, y1: container.y1,
        backgroundColor: toHex(fill),
        borderRadius: isRounded ? 50 : 15,
      },
    });
  }
  return found;
}

export async function detectTextAndShapes(imagePath: string): Promise<{ text: DetectedText[]; shapes: DetectedShape[] }> {
  const png = PNG.sync.read(readFileSync(imagePath));
  const { width: imageWidth, height: imageHeight } = png;

  const worker = await createWorker("eng");

  await worker.setParameters({ tessedit_pageseg_mode: "11" as any });
  const { data } = await worker.recognize(imagePath, {}, { blocks: true });
  const pageLines: DetectedText[] = ((data as any).blocks ?? [])
    .flatMap((block: any) => (block.paragraphs ?? []).flatMap((paragraph: any) => paragraph.lines ?? []))
    .map((line: any) => {
      const { x0, y0, x1, y1 } = line.bbox;
      return {
        text: line.text.trim(),
        x: (x0 / imageWidth) * 100,
        y: (y0 / imageHeight) * 100,
        width: ((x1 - x0) / imageWidth) * 100,
        height: ((y1 - y0) / imageHeight) * 100,
        fontSize: heightToFontSize(y1 - y0),
        confidence: line.confidence,
      };
    })
    .filter((el: DetectedText) => el.text.length > 0);

  const confirmed = await detectConfirmedContainers(png, worker);
  await worker.terminate();

  // container OCR is more trustworthy inside a container than whole-page OCR,
  // so any page-level line landing inside one is dropped in favour of it
  const toBox = (el: DetectedText): Box => ({
    x0: (el.x / 100) * imageWidth,
    y0: (el.y / 100) * imageHeight,
    x1: ((el.x + el.width) / 100) * imageWidth,
    y1: ((el.y + el.height) / 100) * imageHeight,
  });
  const mostlyInside = (line: Box, container: Box): boolean => {
    const ix = Math.min(line.x1, container.x1) - Math.max(line.x0, container.x0);
    const iy = Math.min(line.y1, container.y1) - Math.max(line.y0, container.y0);
    if (ix <= 0 || iy <= 0) return false;
    return (ix * iy) / ((line.x1 - line.x0) * (line.y1 - line.y0)) > 0.5;
  };
  const keptPageLines = pageLines.filter(
    (el) =>
      el.text.replace(/[^A-Za-z0-9]/g, "").length >= 2 &&
      !confirmed.some((r) => mostlyInside(toBox(el), r.container))
  );

  return {
    text: [...keptPageLines, ...confirmed.map((r) => r.text)],
    shapes: confirmed.map((r) => r.shape),
  };
}

export async function detectText(imagePath: string): Promise<DetectedText[]> {
  return (await detectTextAndShapes(imagePath)).text;
}
