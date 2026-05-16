import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dictionaryPath = path.join(process.cwd(), "data", "ecdict.full.csv");
const importStartedAt = new Date("2026-05-03T01:25:00.000Z");
const protectedWords = new Set([
  "sophisticated",
  "philosophy",
  "sophistry",
  "philosopher",
  "dispute",
  "put",
  "compute",
  "reputation",
  "repute",
  "act",
  "active",
  "action",
  "react",
  "interaction",
  "transport",
  "import",
  "export",
  "portable",
  "inspect",
  "respect",
  "suspect",
  "expect",
  "prospect",
  "cylinder",
  "harangue",
  "cycle",
  "line",
  "argue",
  "take",
  "teach",
  "teacher",
  "learn",
  "study"
]);

async function main() {
  if (!fs.existsSync(dictionaryPath)) {
    throw new Error(`Dictionary file not found: ${dictionaryPath}`);
  }

  const allowed = await buildAllowedWordSet();
  for (const word of protectedWords) allowed.add(word);

  let deleted = 0;
  let rounds = 0;
  while (true) {
    const words = await prisma.word.findMany({
      where: {
        createdAt: { gte: importStartedAt },
        word: { notIn: Array.from(allowed) },
        mnemonicEntries: { none: {} },
        bookmarks: { none: {} },
        reviewCards: { none: {} },
        reviewLogs: { none: {} }
      },
      take: 5000,
      select: { id: true }
    });
    if (!words.length) break;
    const result = await prisma.word.deleteMany({ where: { id: { in: words.map((word) => word.id) } } });
    deleted += result.count;
    rounds += 1;
    if (rounds % 5 === 0) console.log(`Cleanup round ${rounds}. deleted=${deleted}`);
  }

  console.log(`Dictionary cleanup complete. allowed=${allowed.size}, deleted=${deleted}`);
}

async function buildAllowedWordSet() {
  const allowed = new Set<string>();
  const rl = readline.createInterface({
    input: fs.createReadStream(dictionaryPath, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  let header = true;
  for await (const line of rl) {
    if (header) {
      header = false;
      continue;
    }
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    const originalWord = (row[0] ?? "").trim();
    const word = originalWord.toLowerCase();
    const phonetic = (row[1] ?? "").trim();
    const rawTranslation = row[3] ?? "";
    const translation = rawTranslation.trim();
    const collins = toRank(row[5] ?? "");
    const oxford = toRank(row[6] ?? "");
    const tag = (row[7] ?? "").trim();
    const bnc = toRank(row[8] ?? "");
    const frq = toRank(row[9] ?? "");
    const rankSignal = Boolean(bnc && frq && bnc < 35000 && frq < 35000);

    if (!/^[a-z]{2,32}$/.test(originalWord)) continue;
    if (!phonetic || !translation) continue;
    if (/abbr\./i.test(rawTranslation)) continue;
    if (/人名|男子名|女子名|城市|州名|地名|网络/.test(rawTranslation)) continue;
    if (!(tag || collins || oxford || rankSignal)) continue;
    allowed.add(word);
  }

  return allowed;
}

function parseCsvLine(line: string) {
  const result: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      result.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  result.push(value);
  return result;
}

function toRank(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
