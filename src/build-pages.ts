import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { z } from "zod";
import { PageSchema } from "./schema";
import { renderSection } from "./renderer";
import { assemblePage } from "./assemble";

// npx tsx src/build-pages.ts [site.json]
// One screenshot per named page -> build/pages/<name>.json (validated page spec)
// + build/pages/<name>.html + build/manifest.json (what the editor will load).

// page names become file names and link targets (<name>.html), so they're
// restricted to a safe slug - no slashes, dots or spaces
const PageName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

const Manifest = z
  .object({
    pages: z
      .array(z.object({ name: PageName, screenshot: z.string().regex(/\.png$/i) }))
      .min(1)
      .max(30),
  })
  .refine((m) => new Set(m.pages.map((p) => p.name)).size === m.pages.length, {
    message: "page names must be unique",
  });

const manifestPath = process.argv[2] ?? "site.json";

function pageDocument(title: string, bodyHtml: string, width: number, height: number): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; }
  .page { width: 100%; max-width: ${width}px; margin: 0 auto; aspect-ratio: ${width} / ${height}; background: #fff; color: #000; font-family: sans-serif; }
  a { text-decoration: none; }
</style>
</head>
<body>
<div class="page">
${bodyHtml}
</div>
</body>
</html>`;
}

async function main() {
  const parsed = Manifest.safeParse(JSON.parse(readFileSync(manifestPath, "utf-8")));
  if (!parsed.success) {
    console.log(`${manifestPath} is invalid:`);
    console.log(JSON.stringify(parsed.error.format(), null, 2));
    process.exit(1);
  }

  mkdirSync("build/pages", { recursive: true });
  const built: { name: string; json: string; html: string; width: number; height: number }[] = [];

  for (const { name, screenshot } of parsed.data.pages) {
    console.log(`\n[${name}] assembling from ${screenshot}...`);
    const { page, width, height } = await assemblePage(screenshot);

    const result = PageSchema.safeParse(page);
    if (!result.success) {
      console.log(`[${name}] INVALID - assembled page doesn't match the schema:`);
      console.log(JSON.stringify(result.error.format(), null, 2));
      process.exit(1);
    }

    const body = result.data.sections.map(renderSection).join("\n");
    writeFileSync(`build/pages/${name}.json`, JSON.stringify(result.data, null, 2));
    writeFileSync(`build/pages/${name}.html`, pageDocument(name, body, width, height));
    built.push({ name, json: `pages/${name}.json`, html: `pages/${name}.html`, width, height });
    console.log(`[${name}] VALID -> build/pages/${name}.json, build/pages/${name}.html`);
  }

  writeFileSync("build/manifest.json", JSON.stringify({ pages: built }, null, 2));
  console.log(`\nWrote build/manifest.json (${built.length} page(s))`);
}

main();
