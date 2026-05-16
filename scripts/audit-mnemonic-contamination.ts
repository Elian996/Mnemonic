import fs from "node:fs/promises";
import path from "node:path";
import type { LevelTag } from "@prisma/client";
import { getMnemonicContaminationAudit } from "../src/lib/mnemonic-contamination-audit";
import { prisma } from "../src/lib/db";

const level = stringArg("--level")?.toUpperCase() as LevelTag | undefined;
const outputArg = stringArg("--output");

async function main() {
  const groups = (await getMnemonicContaminationAudit()).map((group) => ({
    ...group,
    words: level ? group.words.filter((word) => word.levelTags.includes(level)) : group.words
  }));

  const total = groups.reduce((sum, group) => sum + group.words.length, 0);
  const report = {
    createdAt: new Date().toISOString(),
    level: level ?? null,
    total,
    groups: groups.map((group) => ({
      id: group.id,
      title: group.title,
      tone: group.tone,
      count: group.words.length,
      words: group.words.map((word) => ({
        word: word.word,
        slug: word.slug,
        meaning: word.meaning,
        levelTags: word.levelTags,
        details: word.details
      }))
    }))
  };

  const outputPath = outputArg ?? path.join(process.cwd(), "tmp", `mnemonic-contamination-audit-${level?.toLowerCase() ?? "all"}-${Date.now()}.json`);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));

  console.log(`范围：${level ?? "全部"}`);
  console.log(`疑似问题总数：${total}`);
  for (const group of groups) {
    if (!group.words.length) continue;
    console.log(`\n${group.title}：${group.words.length}`);
    for (const word of group.words.slice(0, 40)) {
      console.log(`- ${word.word}: ${word.details.join("；")}`);
    }
    if (group.words.length > 40) console.log(`  ... 还有 ${group.words.length - 40} 个，详见 JSON`);
  }
  console.log(`\n报告：${outputPath}`);
}

function stringArg(name: string) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
