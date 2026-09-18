import { readFileSync } from "fs";
import { PNG } from "pngjs";
import cvModule from "@techstark/opencv-js";

async function getOpenCv(): Promise<any> {
  let cv: any = cvModule;
  if (cv instanceof Promise) {
    cv = await cv;
  } else if (!cv.Mat) {
    await new Promise<void>((resolve) => {
      cv.onRuntimeInitialized = () => resolve();
    });
  }
  return cv;
}

interface DetectedImageRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ExcludeRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const BLOCK_SIZE = 50;
const UNIQUE_COLOR_THRESHOLD = 15;
const COLOR_BUCKET_BITS = 5;
const MIN_REGION_AREA_FRACTION = 0.01;
const MIN_WIDTH_FRACTION = 0.4; // a region must span at least 40% of the image width to count as a photo

export async function detectImageRegions(
  imagePath: string,
  excludeRegions: ExcludeRegion[] = []
): Promise<DetectedImageRegion[]> {
  const cv = await getOpenCv();
  const png = PNG.sync.read(readFileSync(imagePath));
  const { width, height, data } = png;

  // convert exclusion regions from % to pixel bounds once, up front
  const excludePixelBounds = excludeRegions.map(r => ({
    x0: (r.x / 100) * width,
    y0: (r.y / 100) * height,
    x1: ((r.x + r.width) / 100) * width,
    y1: ((r.y + r.height) / 100) * height,
  }));

  function blockIsExcluded(bx: number, by: number): boolean {
    const centerX = bx + BLOCK_SIZE / 2;
    const centerY = by + BLOCK_SIZE / 2;
    return excludePixelBounds.some(r =>
      centerX >= r.x0 && centerX <= r.x1 && centerY >= r.y0 && centerY <= r.y1
    );
  }

  const maskData = new Uint8Array(width * height);

  for (let by = 0; by < height; by += BLOCK_SIZE) {
    for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
      if (blockIsExcluded(bx, by)) continue; // confirmed real text - never a custom/photo candidate

      const seenColors = new Set<number>();

      for (let y = by; y < Math.min(by + BLOCK_SIZE, height); y++) {
        for (let x = bx; x < Math.min(bx + BLOCK_SIZE, width); x++) {
          const i = (y * width + x) * 4;
          const r = data[i] >> COLOR_BUCKET_BITS;
          const g = data[i + 1] >> COLOR_BUCKET_BITS;
          const b = data[i + 2] >> COLOR_BUCKET_BITS;
          seenColors.add((r << 10) | (g << 5) | b);
        }
      }

      if (seenColors.size >= UNIQUE_COLOR_THRESHOLD) {
        for (let y = by; y < Math.min(by + BLOCK_SIZE, height); y++) {
          for (let x = bx; x < Math.min(bx + BLOCK_SIZE, width); x++) {
            maskData[y * width + x] = 255;
          }
        }
      }
    }
  }

  const mask = cv.matFromArray(height, width, cv.CV_8UC1, Array.from(maskData));

  const kernel = cv.Mat.ones(35, 35, cv.CV_8U);
  const merged = new cv.Mat();
  cv.dilate(mask, merged, kernel);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(merged, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const imageArea = width * height;
  const regions: DetectedImageRegion[] = [];

  for (let i = 0; i < contours.size(); i++) {
    const rect = cv.boundingRect(contours.get(i));
    if ((rect.width * rect.height) / imageArea < MIN_REGION_AREA_FRACTION) continue;
    if (rect.width / width < MIN_WIDTH_FRACTION) continue;

    regions.push({
      x: (rect.x / width) * 100,
      y: (rect.y / height) * 100,
      width: (rect.width / width) * 100,
      height: (rect.height / height) * 100,
    });
  }

  [mask, kernel, merged, contours, hierarchy].forEach((m) => m.delete());

  return regions;
}