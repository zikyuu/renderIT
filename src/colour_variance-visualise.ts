import { readFileSync, writeFileSync } from "fs";
import { detectImageRegions } from "./colour_variance-detect";
import { detectText } from "./ocr-detect";

const imagePath = process.argv[2] ?? "screenshots/test1.png";
const CONFIDENCE_THRESHOLD = 70; // Tesseract lines at or above this are treated as confirmed real text

async function main() {
  console.log(`Running OCR on ${imagePath}...`);
  const textElements = await detectText(imagePath);
  const confidentText = textElements.filter(el => el.confidence >= CONFIDENCE_THRESHOLD);
  console.log(`${confidentText.length} of ${textElements.length} text elements are high-confidence (excluded from custom detection).`);

  console.log(`Detecting image regions in ${imagePath}...`);
  const regions = await detectImageRegions(imagePath, confidentText);
  console.log(`Found ${regions.length} region(s).`);

  const imageBase64 = readFileSync(imagePath).toString("base64");
  const mediaType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  const regionBoxes = regions.map(r => `
    <div style="position: absolute; left: ${r.x}%; top: ${r.y}%; width: ${r.width}%; height: ${r.height}%; border: 3px solid #34c759; background: rgba(52,199,89,0.15); box-sizing: border-box;"></div>
  `).join("");

  const textBoxes = confidentText.map(el => `
    <div style="position: absolute; left: ${el.x}%; top: ${el.y}%; width: ${el.width}%; height: ${el.height}%; border: 2px dashed #007aff; box-sizing: border-box;"></div>
  `).join("");

  const html = `<!DOCTYPE html>
<html><body style="margin:0; padding:20px; background:#222;">
<div style="position:relative; display:inline-block;">
<img src="data:${mediaType};base64,${imageBase64}" style="display:block; max-width:100%;" />
${regionBoxes}
${textBoxes}
</div>
</body></html>`;

  writeFileSync("image-region-preview.html", html);
  console.log("Wrote image-region-preview.html");
}

main();