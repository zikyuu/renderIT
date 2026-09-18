import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from process.env automatically

//text to JSON spec prompt - V1 only. V2's screenshot pipeline no longer uses
//an LLM at all (see docs/v2-architecture-notes.md, "Two separate theses") -
//CV measures geometry, OCR reads text, a fine-tuned classifier reads font.
const SYSTEM_PROMPT = `You are a layout generator. Given a plain-English description of a webpage, output ONLY a single JSON object matching this exact structure:

{ "sections": [ <Section>, ... ], "gap" (optional) integer 0-100 - spacing between top-level sections }

A <Section> is one of two types, chosen by its "type" field:

- "rectangle": a content block. Fields:
  - "span": integer 1-100 - relative width weight among sibling sections in the same row
  - "height": integer 1-100 - relative height weight among sibling sections in the same column
  - "backgroundColor" (optional): a CSS color string
  - "clipPath" (optional): a CSS clip-path value, only if this section has a non-rectangular custom outline
  - "textElements" (optional): array of { "text": string, "fontSize": integer 1-100 (100 = large heading, ~20 = small print), "x": integer 0-100 (% from left within this rectangle), "y": integer 0-100 (% from top), "isLink" (optional): boolean, "linkTarget" (optional): string }
  - "imageRegions" (optional): array of { "x": integer 0-100, "y": integer 0-100, "width": integer 0-100, "height": integer 0-100, "clipPath" (optional): string }

- "grid": a layout container, no content of its own. Fields:
  - "span", "height", "backgroundColor" (optional) - same as above
  - "direction": "row" | "column"
  - "columns": array of Section (its children)
  - "gap" (optional): integer 0-100 - spacing between the children

Do not invent new "type" values or fields. Output raw JSON only - no markdown code fences, no explanation, no text before or after the JSON.`;

// Claude sometimes wraps JSON in ```json ... ``` fences even when told not
// to - strip them if present before trying to parse, since that's a common
// enough quirk to handle rather than let it count as "invalid JSON"
function stripCodeFences(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text;
}

// generateSpec's job is just this: take a prompt, return SOME json (unknown,
// unvalidated). Validating it is safeParse's job (inside getValidatedSpec),
// not this function's.
async function generateSpec(prompt: string): Promise<unknown> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = message.content.find(block => block.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";

  try {
    return JSON.parse(stripCodeFences(rawText));
  } catch {
    return rawText; // not valid JSON at all - fails safeParse downstream, handled there
  }
}

export { generateSpec };
