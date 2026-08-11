import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from process.env automatically

const SYSTEM_PROMPT = `You are a layout generator. Given a plain-English description of a webpage, output ONLY a single JSON object matching this exact structure:

{ "sections": [ <Section>, ... ] }

A <Section> is one of six types, chosen by its "type" field. Every section has:
- "type": one of "banner" | "grid" | "card-group" | "sidebar" | "nav" | "footer"
- "span": integer 1-5 - relative width weight among sibling sections in the same row
- "height": integer 1-5 - relative height weight among sibling sections in the same column
- "backgroundColor" (optional): a CSS color string

Additional fields per type:
- "banner": "content": { "heading": string, "subtext"?: string }
- "card-group": "content": { "title": string }
- "sidebar": "content": { "items": string[] }
- "nav": "content": { "links": string[] }
- "footer": "content": { "text": string }
- "grid": "direction": "row" | "column", "columns": Section[]

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
