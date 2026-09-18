import { getValidatedSpec } from "./retry";

// simulates an LLM that never produces valid output - should exhaust the
// retry and land on the fallback
async function alwaysBrokenMock(prompt: string): Promise<unknown> {
  console.log(`[always-broken mock] called`);
  return { sections: [{ type: "not-a-real-type" }] };
}

// simulates an LLM that gets it wrong once, then gets it right on retry -
// should succeed via the SECOND attempt, never touching the fallback
let attempt = 0;
async function brokenThenFixedMock(prompt: string): Promise<unknown> {
  attempt++;
  console.log(`[broken-then-fixed mock] attempt ${attempt}`);
  if (attempt === 1) {
    return { sections: [{ type: "rectangle", span: 1 }] }; // missing required "height"
  }
  return {
    sections: [
      { type: "rectangle", span: 1, height: 1, textElements: [{ text: "Fixed on retry!", fontSize: 60, x: 10, y: 40 }] },
    ],
  };
}

async function main() {
  console.log("=== Scenario 1: always broken -> should fall back ===");
  const fallback = await getValidatedSpec("test prompt", alwaysBrokenMock);
  console.log("usedFallback:", fallback.usedFallback);
  console.log(JSON.stringify(fallback.data));

  console.log("\n=== Scenario 2: broken once, fixed on retry -> should succeed, no fallback ===");
  const retried = await getValidatedSpec("test prompt", brokenThenFixedMock);
  console.log("usedFallback:", retried.usedFallback);
  console.log(JSON.stringify(retried.data));
}

main();
