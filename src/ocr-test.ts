import { detectText } from "./ocr-detect";

// pass an image path as an argument, e.g.:
//   npx tsx src/ocr-test.ts screenshots/test2.png
// defaults to test1.png if nothing is given
const imagePath = process.argv[2] ?? "screenshots/test1.png";

async function main() {
  console.log(`Running OCR on ${imagePath}...`);
  const results = await detectText(imagePath);
  console.log(JSON.stringify(results, null, 2));
}

main();
