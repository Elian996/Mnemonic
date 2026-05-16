import { revalidatePath } from "next/cache";
import { WordMarkState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { vocabCategories } from "@/lib/vocab-categories";

export async function persistWordMarkState(userId: string, wordId: string, state: WordMarkState | null) {
  await persistWordMarkStates(userId, [[wordId, state]]);
}

export async function persistWordMarkStates(userId: string, changes: Array<[string, WordMarkState | null]>) {
  const dedupedChanges = Array.from(
    changes
      .filter(([wordId]) => Boolean(wordId))
      .reduce((map, [wordId, state]) => map.set(wordId, state), new Map<string, WordMarkState | null>())
      .entries()
  );
  if (!dedupedChanges.length) return;

  await prisma.$transaction(async (tx) => {
    const clearedWordIds = dedupedChanges.filter(([, state]) => state === null).map(([wordId]) => wordId);
    if (clearedWordIds.length) {
      await tx.wordMark.deleteMany({ where: { userId, wordId: { in: clearedWordIds } } });
      await tx.bookmark.deleteMany({ where: { userId, wordId: { in: clearedWordIds }, mnemonicEntryId: null } });
    }

    for (const [wordId, state] of dedupedChanges) {
      if (state === null) continue;

      await tx.wordMark.upsert({
        where: { userId_wordId: { userId, wordId } },
        update: { state },
        create: { userId, wordId, state }
      });

      if (state === WordMarkState.UNKNOWN) {
        const existing = await tx.bookmark.findFirst({
          where: { userId, wordId, mnemonicEntryId: null },
          select: { id: true }
        });
        if (!existing) {
          await tx.bookmark.create({ data: { userId, wordId } });
        }
      } else {
        await tx.bookmark.deleteMany({ where: { userId, wordId, mnemonicEntryId: null } });
      }
    }
  });

  await revalidateWordMarkViews(dedupedChanges.map(([wordId]) => wordId));
}

async function revalidateWordMarkViews(wordIds: string[]) {
  revalidatePath("/me");
  revalidatePath("/me/known");
  revalidatePath("/me/fuzzy");
  revalidatePath("/me/unknown");
  const words = await prisma.word.findMany({
    where: { id: { in: wordIds } },
    select: { slug: true, levelTags: true }
  });

  const paths = new Set<string>();
  for (const word of words) {
    paths.add(`/word/${word.slug}`);
    for (const category of vocabCategories) {
      if (word.levelTags.includes(category.tag)) {
        paths.add(`/levels/${category.slug}`);
      }
    }
  }
  for (const path of paths) {
    revalidatePath(path);
  }
}
