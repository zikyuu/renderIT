import { readFileSync, writeFileSync } from "fs";
import { PageSchema } from "./schema";
import { renderSection, gapToRem } from "./renderer";

// paste whatever JSON ChatGPT (or any LLM) gives you into manual-spec.json,
// then run: npx tsx src/manual-test.ts
const raw = readFileSync("manual-spec.json", "utf-8");

let rawSpec: unknown;
try {
  rawSpec = JSON.parse(raw);
} catch (e) {
  console.log("manual-spec.json isn't even valid JSON:");
  console.log(e);
  process.exit(1);
}

const result = PageSchema.safeParse(rawSpec);

if (!result.success) {
  console.log("INVALID — doesn't match the schema:");
  console.log(result.error.format());
} else {
  console.log("VALID");
  const bodyHtml = result.data.sections.map(renderSection).join("\n");
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<title>LAYOUTry preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; flex-direction: column; gap: ${gapToRem(result.data.gap)}; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  writeFileSync("output.html", fullHtml);
  console.log("Wrote output.html");
}
