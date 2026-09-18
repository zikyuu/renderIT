import { createWorker } from "tesseract.js";
import { readFileSync } from "fs";
import { PNG } from "pngjs";

// npx tsx src/ocr-debug-top.ts screenshots/test2.png
const base = process.argv[2] ?? "screenshots/test2.png";
const variants = [base, base.replace(/\.png$/, "-preprocessed.png")];

async function main() {
  const { height } = PNG.sync.read(readFileSync(base));

  for (const path of variants) {
    const worker = await createWorker("eng");
    await worker.setParameters({ tessedit_pageseg_mode: "11" as any });
    const { data } = await worker.recognize(path, {}, { blocks: true });
    await worker.terminate();

    const lines = ((data as any).blocks ?? []).flatMap((b: any) =>
      (b.paragraphs ?? []).flatMap((p: any) => p.lines ?? [])
    );

    console.log(`\n=== ${path} (top 45% of image only) ===`);
    for (const line of lines) {
      if (line.bbox.y0 / height > 0.45) continue;
      console.log(
        `conf ${Math.round(line.confidence).toString().padStart(3)} | y ${((line.bbox.y0 / height) * 100).toFixed(0).padStart(2)}% | "${line.text.trim()}"`
      );
    }
  }
}

main();