import { readFileSync, writeFileSync } from "fs";
import { PNG } from "pngjs";

const BLOCK_SIZE = 30;
const COLOR_BUCKET_BITS = 5;

const imagePath = process.argv[2] ?? "screenshots/test1.png";
const png = PNG.sync.read(readFileSync(imagePath));
const { width, height, data } = png;

const boxes: string[] = [];

for (let by = 0; by < height; by += BLOCK_SIZE) {
  for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
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

    // 0 count -> transparent, higher count -> more opaque red
    const alpha = Math.min(seenColors.size / 42, 1) * 0.85;
    boxes.push(
      `<div style="position:absolute; left:${(bx / width) * 100}%; top:${(by / height) * 100}%; width:${(BLOCK_SIZE / width) * 100}%; height:${(BLOCK_SIZE / height) * 100}%; background: rgba(255,0,0,${alpha});"></div>`
    );
  }
}

const imageBase64 = readFileSync(imagePath).toString("base64");
const mediaType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

const html = `<!DOCTYPE html>
<html><body style="margin:0; padding:20px; background:#222;">
<div style="position:relative; display:inline-block;">
<img src="data:${mediaType};base64,${imageBase64}" style="display:block; max-width:100%;" />
${boxes.join("")}
</div>
</body></html>`;

writeFileSync("colour-heatmap-preview.html", html);
console.log("Wrote colour-heatmap-preview.html");