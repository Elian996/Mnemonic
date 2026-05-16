import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sourceDir = path.join(process.cwd(), "data", "vocab-categories");

const noiseWords = new Set([
  "acat",
  "activ",
  "aira",
  "ake",
  "ands",
  "arat",
  "ayp",
  "bada",
  "baga",
  "balla",
  "bandas",
  "barea",
  "basica",
  "beara",
  "bga",
  "bigart",
  "ble",
  "blo",
  "bor",
  "bre",
  "caf",
  "cagle",
  "cbo",
  "cea",
  "cesa",
  "chines",
  "cial",
  "cien",
  "cise",
  "ck",
  "coffe",
  "dprk",
  "eem",
  "ele",
  "en",
  "ence",
  "engl",
  "erio",
  "ess",
  "etu",
  "fale",
  "fando",
  "fdo",
  "fers",
  "fes",
  "fim",
  "fiu",
  "fter",
  "fth",
  "fti",
  "ght",
  "gung",
  "hape",
  "heep",
  "hef",
  "helf",
  "hfo",
  "hig",
  "hih",
  "hith",
  "hom",
  "hort",
  "hpp",
  "hso",
  "hth",
  "hury",
  "ict",
  "iet",
  "iger",
  "iser",
  "ive",
  "iy",
  "lant",
  "leep",
  "lete",
  "litle",
  "ltt",
  "lue",
  "mli",
  "mym",
  "nack",
  "ne",
  "ning",
  "nort",
  "ock",
  "octo",
  "ofa",
  "offr",
  "ofm",
  "oly",
  "ome",
  "ose",
  "oun",
  "ouro",
  "ous",
  "oy",
  "peci",
  "peper",
  "pera",
  "ple",
  "poil",
  "princep",
  "qpa",
  "rdl",
  "rin",
  "rpa",
  "rtis",
  "ry",
  "schol",
  "shys",
  "simples",
  "sres",
  "stil",
  "taura",
  "tenis",
  "teri",
  "theta",
  "tmas",
  "tra",
  "trang",
  "tre",
  "tres",
  "tric",
  "tro",
  "tta",
  "ture",
  "ty",
  "uf",
  "uits",
  "upp",
  "urso",
  "uthe",
  "vcd",
  "warus",
  "wor",
  "wun",
  "xc",
  "xer",
  "xw",
  "yf",
  "ys",
  "yw",
  "zo"
]);

async function main() {
  const sourceFiles = fs
    .readdirSync(sourceDir)
    .filter((file) => file.endsWith(".txt"))
    .map((file) => path.join(sourceDir, file));

  let removedSourceLines = 0;
  for (const filePath of sourceFiles) {
    const original = fs.readFileSync(filePath, "utf8");
    const lines = original.split(/\r?\n/);
    const filtered = lines.filter((line) => !noiseWords.has(line.trim().toLowerCase()));
    const removed = lines.length - filtered.length;
    if (!removed) continue;

    removedSourceLines += removed;
    fs.writeFileSync(filePath, `${filtered.join("\n").replace(/\n+$/g, "")}\n`);
    console.log(`${path.relative(process.cwd(), filePath)}: removed ${removed}`);
  }

  const existing = await prisma.word.findMany({
    where: { word: { in: Array.from(noiseWords) } },
    select: { word: true, levelTags: true }
  });
  const deleted = await prisma.word.deleteMany({
    where: { word: { in: Array.from(noiseWords) } }
  });

  console.log(`Source lines removed: ${removedSourceLines}`);
  console.log(`Database words matched: ${existing.length}`);
  console.log(`Database words deleted: ${deleted.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
