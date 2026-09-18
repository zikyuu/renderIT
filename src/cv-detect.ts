import { readFileSync } from "fs";
import { PNG } from "pngjs";
import cvModule from "@techstark/opencv-js";

const MAGENTA = { r: 255, g: 0, b: 255 };
const COLOR_TOLERANCE = 30; // how close a pixel has to be to count as "the marker color"

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

interface DetectedShape {
  x: number; // % from left, relative to the whole image
  y: number; // % from top
  width: number; // %
  height: number; // %
  clipPath?: string; // only set if the outline isn't basically a plain rectangle
}

type DetectionResult =
  | { success: true; shape: DetectedShape }
  | { success: false; markerX: number; markerY: number }; // marker found, no enclosing outline - caller should prompt for a border

export async function detectFloatingElements(imagePath: string): Promise<DetectionResult[]> {
  const cv = await getOpenCv();

  const png = PNG.sync.read(readFileSync(imagePath));
  const src = cv.matFromArray(png.height, png.width, cv.CV_8UC4, Array.from(png.data));

  // 1. find every marker: threshold for pixels close to the reserved magenta color
  const lowerBound = new cv.Mat(src.rows, src.cols, src.type(), [
    MAGENTA.r - COLOR_TOLERANCE, MAGENTA.g - COLOR_TOLERANCE, MAGENTA.b - COLOR_TOLERANCE, 0,
  ]);
  const upperBound = new cv.Mat(src.rows, src.cols, src.type(), [
    MAGENTA.r + COLOR_TOLERANCE, MAGENTA.g + COLOR_TOLERANCE, MAGENTA.b + COLOR_TOLERANCE, 255,
  ]);
  const markerMask = new cv.Mat();
  cv.inRange(src, lowerBound, upperBound, markerMask);

  const markerContours = new cv.MatVector();
  const markerHierarchy = new cv.Mat();
  cv.findContours(markerMask, markerContours, markerHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const markers: { x: number; y: number }[] = [];
  for (let i = 0; i < markerContours.size(); i++) {
    const rect = cv.boundingRect(markerContours.get(i));
    markers.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  }

  // 2. find every drawn outline in the image, independent of the markers -
  // this traces the border stroke itself, so it doesn't care what's filled
  // inside (empty, a photo, whatever)
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  const edges = new cv.Mat();
  cv.Canny(gray, edges, 50, 150);

  const shapeContours = new cv.MatVector();
  const shapeHierarchy = new cv.Mat();
  cv.findContours(edges, shapeContours, shapeHierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

  // 3. for each marker, find which drawn outline actually encloses it -
  // the marker is a pointer to a pre-existing outline, not something that
  // defines a shape by itself
  const results: DetectionResult[] = markers.map((marker) => {
    for (let i = 0; i < shapeContours.size(); i++) {
      const contour = shapeContours.get(i);
      const inside = cv.pointPolygonTest(contour, new cv.Point(marker.x, marker.y), false);
      if (inside < 0) continue;

      const rect = cv.boundingRect(contour);
      const shape: DetectedShape = {
        x: (rect.x / png.width) * 100,
        y: (rect.y / png.height) * 100,
        width: (rect.width / png.width) * 100,
        height: (rect.height / png.height) * 100,
      };

      // simplify the contour to a polygon; if it collapses to ~4 points it's
      // basically just its own bounding rectangle, so no clipPath is needed
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.01 * cv.arcLength(contour, true), true);
      if (approx.rows > 4) {
        const points: string[] = [];
        for (let p = 0; p < approx.rows; p++) {
          const px = approx.data32S[p * 2];
          const py = approx.data32S[p * 2 + 1];
          points.push(`${(((px - rect.x) / rect.width) * 100).toFixed(1)}% ${(((py - rect.y) / rect.height) * 100).toFixed(1)}%`);
        }
        shape.clipPath = `polygon(${points.join(", ")})`;
      }
      approx.delete();

      return { success: true, shape };
    }

    return {
      success: false,
      markerX: (marker.x / png.width) * 100,
      markerY: (marker.y / png.height) * 100,
    };
  });

  [src, lowerBound, upperBound, markerMask, markerContours, markerHierarchy,
    gray, edges, shapeContours, shapeHierarchy].forEach((m) => m.delete());

  return results;
}
