import fs from "node:fs";
import path from "node:path";
import { MnemonicSourceType, MnemonicStatus, Prisma, type MnemonicEntry, type Word } from "@prisma/client";
import { prisma } from "@/lib/db";
import { syncEntryWikiLinks } from "@/lib/wiki-links/resolve";

const backupPath = path.join(process.cwd(), "backups/mnemonic-before-p0-source-repair-1778842259505.json");
const marker = "codex-p0-source-repair-2026-05-15";
const cutoff = new Date("2026-05-15T10:50:59.000Z");
const restoreAction = "CODEX_RESTORE_MANUAL_P0_BEFORE_SOURCE_REPAIR";
const manualActions = [
  "MNEMONIC_QUICK_UPDATE",
  "MNEMONIC_QUICK_CREATE",
  "MNEMONIC_QUICK_DELETE",
  "MNEMONIC_QUICK_RESTORE",
  "MNEMONIC_SAVE",
  "MNEMONIC_ARCHIVE",
  "MNEMONIC_PROMOTE"
];

type BackupWord = Word & {
  mnemonicEntries: BackupMnemonicEntry[];
};

type BackupMnemonicEntry = MnemonicEntry & {
  versions?: unknown[];
  links?: unknown[];
};

type BackupData = {
  marker: string;
  createdAt: string;
  words: BackupWord[];
};

type ManualLog = {
  action: string;
  entityId: string;
  entityType: string;
  metadataJson: Prisma.JsonValue | null;
  createdAt: Date;
};

async function main() {
  const apply = process.argv.includes("--apply");
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8")) as BackupData;
  const wordById = new Map(backup.words.map((word) => [word.id, word]));
  const entryToWord = new Map<string, BackupWord>();
  for (const word of backup.words) {
    for (const entry of word.mnemonicEntries ?? []) entryToWord.set(entry.id, word);
  }

  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: manualActions },
      createdAt: { lt: cutoff }
    },
    select: {
      action: true,
      entityId: true,
      entityType: true,
      metadataJson: true,
      createdAt: true
    },
    orderBy: { createdAt: "asc" }
  });
  const logsByWordId = manualLogsByWordId(logs, wordById, entryToWord);
  const candidates = backup.words
    .filter((word) => logsByWordId.has(word.id))
    .sort((left, right) => left.word.localeCompare(right.word));
  const actorId = await resolveActorId();

  const summary = {
    mode: apply ? "apply" : "dry-run",
    backupPath,
    marker,
    manualWordCount: candidates.length,
    words: candidates.map((word) => ({
      word: word.word,
      status: word.status,
      activeOfficialEntries: word.mnemonicEntries
        .filter((entry) => entry.sourceType === MnemonicSourceType.OFFICIAL && entry.status !== MnemonicStatus.ARCHIVED)
        .map((entry) => ({
          id: entry.id,
          status: entry.status,
          splitText: entry.splitText
        })),
      manualActions: uniqueStrings(logsByWordId.get(word.id)?.map((log) => log.action) ?? []),
      manualLogCount: logsByWordId.get(word.id)?.length ?? 0
    }))
  };

  if (!apply) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  let restored = 0;
  let archivedCodexEntries = 0;
  for (const word of candidates) {
    const result = await restoreWord(word, logsByWordId.get(word.id) ?? [], actorId);
    restored += 1;
    archivedCodexEntries += result.archivedCodexEntryIds.length;
  }

  console.log(
    JSON.stringify(
      {
        ...summary,
        restored,
        archivedCodexEntries
      },
      null,
      2
    )
  );
}

function manualLogsByWordId(
  logs: ManualLog[],
  wordById: Map<string, BackupWord>,
  entryToWord: Map<string, BackupWord>
) {
  const logsByWordId = new Map<string, ManualLog[]>();
  for (const log of logs) {
    const metadata = readObject(log.metadataJson);
    if (metadata.sourceType && metadata.sourceType !== MnemonicSourceType.OFFICIAL) continue;
    const word =
      (typeof metadata.wordId === "string" ? wordById.get(metadata.wordId) : null) ??
      (log.entityType === "MnemonicEntry" ? entryToWord.get(log.entityId) : null);
    if (!word) continue;
    const existing = logsByWordId.get(word.id) ?? [];
    existing.push(log);
    logsByWordId.set(word.id, existing);
  }
  return logsByWordId;
}

async function restoreWord(word: BackupWord, manualLogs: ManualLog[], actorId: string) {
  return prisma.$transaction(async (tx) => {
    const codexEntries = await tx.mnemonicEntry.findMany({
      where: {
        targetWordId: word.id,
        sourceType: MnemonicSourceType.OFFICIAL,
        status: { not: MnemonicStatus.ARCHIVED },
        editorNote: { contains: marker }
      },
      select: { id: true }
    });
    const codexEntryIds = codexEntries.map((entry) => entry.id);

    if (codexEntryIds.length) {
      await tx.memoryLink.deleteMany({ where: { sourceMnemonicEntryId: { in: codexEntryIds } } });
      await tx.mnemonicEntry.updateMany({
        where: { id: { in: codexEntryIds } },
        data: {
          status: MnemonicStatus.ARCHIVED,
          isPublic: false,
          isOfficialRecommended: false,
          editorNote: `${marker}: archived because pre-existing manual edit was restored`
        }
      });
    }

    await tx.word.update({
      where: { id: word.id },
      data: {
        word: word.word,
        slug: word.slug,
        phoneticUk: word.phoneticUk,
        phoneticUs: word.phoneticUs,
        audioUkUrl: word.audioUkUrl,
        audioUsUrl: word.audioUsUrl,
        partOfSpeech: word.partOfSpeech,
        meaningCn: word.meaningCn,
        meaningEn: word.meaningEn,
        shortMeaningCn: word.shortMeaningCn,
        exampleSentence: word.exampleSentence,
        exampleTranslation: word.exampleTranslation,
        levelTags: word.levelTags,
        frequencyRank: word.frequencyRank,
        difficulty: word.difficulty,
        status: word.status
      }
    });

    const restoredEntryIds: string[] = [];
    for (const entry of word.mnemonicEntries ?? []) {
      const data = mnemonicEntryData(entry);
      const existing = await tx.mnemonicEntry.findUnique({ where: { id: entry.id }, select: { id: true } });
      if (existing) {
        await tx.mnemonicEntry.update({ where: { id: entry.id }, data });
      } else {
        await tx.mnemonicEntry.create({ data: { id: entry.id, ...data } });
      }
      restoredEntryIds.push(entry.id);
      if (entry.status !== MnemonicStatus.ARCHIVED) {
        await syncEntryWikiLinks(entry.id, actorId, tx);
      }
    }

    await tx.auditLog.create({
      data: {
        actorId,
        action: restoreAction,
        entityType: "Word",
        entityId: word.id,
        metadataJson: {
          marker,
          word: word.word,
          restoredEntryIds,
          archivedCodexEntryIds: codexEntryIds,
          manualActions: uniqueStrings(manualLogs.map((log) => log.action)),
          manualLogCount: manualLogs.length
        } satisfies Prisma.InputJsonObject
      }
    });

    return { archivedCodexEntryIds: codexEntryIds };
  });
}

function mnemonicEntryData(entry: BackupMnemonicEntry): Prisma.MnemonicEntryUncheckedCreateInput {
  return {
    targetWordId: entry.targetWordId,
    authorId: entry.authorId,
    sourceType: entry.sourceType,
    status: entry.status,
    title: entry.title,
    splitText: entry.splitText,
    contentMarkdown: entry.contentMarkdown,
    contentHtml: entry.contentHtml,
    plainText: entry.plainText,
    editorNote: entry.editorNote,
    reviewNote: entry.reviewNote,
    reviewerId: entry.reviewerId,
    reviewedAt: entry.reviewedAt,
    isOfficialRecommended: entry.isOfficialRecommended,
    isPublic: entry.isPublic,
    sortOrder: entry.sortOrder,
    editorScore: entry.editorScore,
    likeCount: entry.likeCount,
    bookmarkCount: entry.bookmarkCount,
    reportCount: entry.reportCount,
    viewCount: entry.viewCount,
    effectivenessScore: entry.effectivenessScore,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  };
}

async function resolveActorId() {
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
    orderBy: { createdAt: "asc" }
  });
  if (!admin) throw new Error("No admin user found for audit log.");
  return admin.id;
}

function readObject(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, Prisma.JsonValue>;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
