import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { basename, extname } from "path";
import { PageSchema } from "./schema";
import { renderSection } from "./renderer";
import { assemblePage } from "./assemble";

// npx tsx src/screenshot-to-html.ts screenshots/test2.png
// writes demo/<name>-spec.json and demo/<name>-preview.html, one pair per
// input image, so running it on several screenshots doesn't overwrite the last result
const imagePath = process.argv[2] ?? "screenshots/test2.png";
const name = basename(imagePath, extname(imagePath));
mkdirSync("demo", { recursive: true });

async function main() {
  console.log(`Assembling page from ${imagePath}...`);
  const { page, width, height, bands } = await assemblePage(imagePath);

  console.log("Bands (top to bottom):");
  for (const b of bands) {
    console.log(`  ${b.kind.padEnd(5)} rows ${b.y0}-${b.y1} (${((b.y0 / height) * 100).toFixed(0)}%-${((b.y1 / height) * 100).toFixed(0)}%)`);
  }

  // the assembled JSON goes through the same validation gate as V1's LLM output -
  // here it guards against bugs in the measurement code rather than model mistakes
  const result = PageSchema.safeParse(page);
  if (!result.success) {
    console.log("INVALID - assembled page doesn't match the schema:");
    console.log(JSON.stringify(result.error.format(), null, 2));
    writeFileSync(`demo/${name}-spec.json`, JSON.stringify(page, null, 2));
    process.exit(1);
  }
  console.log("VALID");
  writeFileSync(`demo/${name}-spec.json`, JSON.stringify(result.data, null, 2));

  const bodyHtml = result.data.sections.map(renderSection).join("\n");
  const original = readFileSync(imagePath).toString("base64");
  const html = `<!DOCTYPE html>
<html>
<head>
<title>LAYOUTry V2 preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #222; font-family: sans-serif; color: #ddd; }
  h2 { font: 600 13px sans-serif; margin: 16px 0 6px; }
  .frame { width: min(100%, ${width}px); }
  .rendered { aspect-ratio: ${width} / ${height}; background: #fff; color: #000; }
  img { display: block; width: 100%; }
</style>
</head>
<body>
<h2>Rendered from page-spec.json</h2>
<div class="frame rendered">
${bodyHtml}
</div>
<h2>Original screenshot</h2>
<div class="frame"><img src="data:image/png;base64,${original}" /></div>
</body>
</html>`;
  writeFileSync(`demo/${name}-preview.html`, html);
  console.log(`Wrote demo/${name}-spec.json and demo/${name}-preview.html`);
}

main();
