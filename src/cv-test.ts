import { readFileSync } from "fs";
import { PNG } from "pngjs";
import cvModule from "@techstark/opencv-js";

// minimal proof-of-concept: does opencv-js actually load and process an
// image in a plain Node/tsx environment? nothing algorithmic yet, just
// verifying the toolchain works before building the real detection logic
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

async function main() {
  console.log("Waiting for opencv-js to initialize...");
  const cv = await getOpenCv();
  console.log("opencv-js ready, cv.Mat exists:", typeof cv.Mat);

  const png = PNG.sync.read(readFileSync("screenshots/test1.png"));
  console.log(`Decoded PNG: ${png.width}x${png.height}`);

  const mat = cv.matFromArray(png.height, png.width, cv.CV_8UC4, Array.from(png.data));
  console.log("Created cv.Mat with size:", mat.rows, "x", mat.cols);

  mat.delete();
}

main();
