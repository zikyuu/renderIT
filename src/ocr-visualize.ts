import { readFileSync, writeFileSync } from "fs";
import { detectText } from "./ocr-detect";

// npx tsx src/ocr-visualize.ts screenshots/test2.png
const imagePath = process.argv[2] ?? "screenshots/test1.png";

async function main() {
  console.log(`Running OCR on ${imagePath}...`);
  const results = await detectText(imagePath);
  console.log(`Found ${results.length} text element(s).`);

  const imageBase64 = readFileSync(imagePath).toString("base64");
  const mediaType = imagePath.endsWith(".png") ? "image/png" : "image/jpeg";

  // one box per detected element, positioned with the exact same x/y
  // percentages that would go into a real TextElement - if a box doesn't
  // land on the real text, that's the OCR's measurement being off, not a
  // rendering bug
  const boxesHtml = results.map(el => `
    <div style="position: absolute; left: ${el.x}%; top: ${el.y}%; border: 2px solid #ff2d55; background: rgba(255,45,85,0.15); padding: 2px 4px; font: 11px monospace; color: #ff2d55; white-space: nowrap; transform: translateY(-100%);">
      "${el.text}" (fontSize ${el.fontSize})
    </div>
  `).join("");

  const html = `<!DOCTYPE html>
<html>
<head><title>OCR preview</title></head>
<body style="margin: 0; padding: 20px; background: #222;">
  <div style="position: relative; display: inline-block;">
    <img src="data:${mediaType};base64,${imageBase64}" style="display: block; max-width: 100%;" />
    ${boxesHtml}
  </div>
</body>
</html>`;

  writeFileSync("ocr-preview.html", html);
  console.log("Wrote ocr-preview.html");
}

main();
