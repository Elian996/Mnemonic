import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const url =
  process.argv[2] ??
  "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv";
const output = path.join(process.cwd(), "data", "ecdict.csv");
const attempts = 3;

await fs.promises.mkdir(path.dirname(output), { recursive: true });

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    console.log(`Downloading ECDICT from ${url} (attempt ${attempt}/${attempts})`);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }
    await pipeline(response.body, fs.createWriteStream(output));
    console.log(`Saved to ${output}`);
    process.exit(0);
  } catch (error) {
    if (attempt === attempts) throw error;
    console.warn(`Download failed, retrying: ${error instanceof Error ? error.message : String(error)}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  } finally {
    clearTimeout(timeout);
  }
}
