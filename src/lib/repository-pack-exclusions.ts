import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { repositoryWordPackExcludeActionForScope } from "@/lib/repository-word-pack";

export async function recordRepositoryPackExclusions({
  actorId,
  wordIds,
  packScope
}: {
  actorId: string;
  wordIds: string[];
  packScope: string;
}) {
  const excludeAction = repositoryWordPackExcludeActionForScope(packScope);
  if (!excludeAction) return { removedCount: 0, removedWordIds: [] as string[] };

  const ids = uniqueStrings(wordIds);
  if (!ids.length) return { removedCount: 0, removedWordIds: [] as string[] };

  const words = await prisma.word.findMany({
    where: { id: { in: ids } },
    select: { id: true, word: true, slug: true }
  });
  if (!words.length) return { removedCount: 0, removedWordIds: [] as string[] };

  const existingLogs = await prisma.auditLog.findMany({
    where: {
      action: excludeAction,
      entityType: "Word",
      entityId: { in: words.map((word) => word.id) }
    },
    select: { entityId: true }
  });
  const existingWordIds = new Set(existingLogs.map((log) => log.entityId));
  const wordsToExclude = words.filter((word) => !existingWordIds.has(word.id));
  if (!wordsToExclude.length) return { removedCount: 0, removedWordIds: [] as string[] };

  await prisma.$transaction(
    wordsToExclude.map((word) =>
      prisma.auditLog.create({
        data: {
          actorId,
          action: excludeAction,
          entityType: "Word",
          entityId: word.id,
          metadataJson: {
            packScope,
            word: word.word,
            slug: word.slug,
            removedAt: new Date().toISOString()
          } satisfies Prisma.InputJsonObject
        }
      })
    )
  );

  return {
    removedCount: wordsToExclude.length,
    removedWordIds: wordsToExclude.map((word) => word.id)
  };
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
