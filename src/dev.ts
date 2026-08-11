import { writeFileSync } from "fs";
import { renderSection } from "./renderer";
import { generateSpec } from "./llm";
import { getValidatedSpec } from "./retry";

// THIS IS THE ACTUAL PIPELINE RUNNER
// prompt -> generate -> validate/retry/fallback -> render -> output html

// top-level code in an async function so we can "await" the LLM call -
// generateSpec returns a Promise, and await pauses this function until that
// Promise resolves, without blocking the rest of the program the way a
// synchronous wait would
async function main() {
  const prompt = "A store homepage with a sidebar of filters, a welcome banner, and new arrivals / best sellers below it";

  const { data, usedFallback } = await getValidatedSpec(prompt, generateSpec);
  if (usedFallback) {
    console.log("Note: had to fall back to the default layout.");
  }

  const bodyHtml = data.sections.map(renderSection).join("\n");
  const fullHtml = `<!DOCTYPE html>
<html>
<head>
<title>LAYOUTry preview</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; display: flex; flex-direction: column; gap: 1rem; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

  writeFileSync("output.html", fullHtml);
  console.log("Wrote output.html");
}

main();
