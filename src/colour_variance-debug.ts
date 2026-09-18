import { readFileSync } from "fs";
import { PNG } from "pngjs";

const BLOCK_SIZE = 50;
const COLOR_BUCKET_BITS = 5;

const imagePath = process.argv[2] ?? "screenshots/test1.png";
const png = PNG.sync.read(readFileSync(imagePath));
const { width, height, data } = png;

const counts: number[] = [];

for (let by = 0; by < height; by += BLOCK_SIZE) {
  for (let bx = 0; bx < width; bx += BLOCK_SIZE) {
    const seenColors = new Set<number>();

    for (let y = by; y < Math.min(by + BLOCK_SIZE, height); y++) {
      for (let x = bx; x < Math.min(bx + BLOCK_SIZE, width); x++) {
        const i = (y * width + x) * 4;
        const r = data[i] >> COLOR_BUCKET_BITS;
        const g = data[i + 1] >> COLOR_BUCKET_BITS;
        const b = data[i + 2] >> COLOR_BUCKET_BITS;
        seenColors.add((r << 10) | (g << 5) | b);
      }
    }

    counts.push(seenColors.size);
  }
}

counts.sort((a, b) => a - b);
console.log(`Blocks analyzed: ${counts.length}`);
console.log(`Min: ${counts[0]}, Max: ${counts[counts.length - 1]}`);
console.log(`Median: ${counts[Math.floor(counts.length / 2)]}`);
console.log(`90th percentile: ${counts[Math.floor(counts.length * 0.9)]}`);
console.log(`Top 10 highest block counts:`, counts.slice(-10));