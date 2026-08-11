import {z} from "zod";
import {PageSchema} from "./schema";

//supplies getValidatedSpec, which wraps generateSpec with validation and fallback logic
//standaline helper function, no main (), calls no renderer and doesnt write html

const FALLBACK_SPEC = {
    sections: [
        {
            type: "banner", span: 1, height: 1,
            content: { heading: "We couldn't generate that layout", 
                subtext: "Please try rephrasing your request" },
        },
    ],
};

// need to match this shape 
// lets us say "give me any function like this" (be it mock LLM, real LLM, or fallback)
// as a paramter type rather than being locked onto one specific function
type GenerateSpecFn = (prompt: string) => Promise<unknown>;
//NOTE: THIS IS A TYPE (NOT VALUE!)

async function getValidatedSpec(
    prompt: string,
    generateSpec: GenerateSpecFn): Promise<{ data: z.infer<typeof PageSchema>; usedFallback: boolean }> {
        const firstTry = await generateSpec(prompt);
        const firstResult = PageSchema.safeParse(firstTry);
        if (firstResult.success) {
            return { data: firstResult.data, usedFallback: false };
        }

  console.log("[retry] first attempt invalid, retrying once with the error fed back:");
  console.log(firstResult.error.format());

  const retryPrompt = `Your previous JSON output was invalid.
Original request: ${prompt}
Your output: ${JSON.stringify(firstTry)}
Validation errors: ${JSON.stringify(firstResult.error.format())}
Please return corrected JSON that fixes these errors and still satisfies the original request.`;

  const secondTry = await generateSpec(retryPrompt);
  const secondResult = PageSchema.safeParse(secondTry);
  if (secondResult.success) {
    return { data: secondResult.data, usedFallback: false };
  }

  console.log("[retry] second attempt also invalid, falling back to the default layout:");
  console.log(secondResult.error.format());

  const fallbackResult = PageSchema.safeParse(FALLBACK_SPEC);
  if (!fallbackResult.success) {
    // this would mean FALLBACK_SPEC itself is broken - a bug in our own code, not the LLM's fault
    throw new Error("FALLBACK_SPEC does not match PageSchema - this is a bug");
  }

  return { data: fallbackResult.data, usedFallback: true };
}

export { getValidatedSpec };