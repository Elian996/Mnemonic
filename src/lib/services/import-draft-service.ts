"use server";

import { ImportDraft, MnemonicSourceType, MnemonicStatus, Prisma, User, UserRole, Word, WordStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import { slugify } from "@/lib/slug";
import { getWordAutofill } from "@/lib/word-autofill";
import { markdownToPlainText, renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { ensureWordNode, syncEntryWikiLinks } from "@/lib/wiki-links/resolve";
import { parseWikiLinks } from "@/lib/wiki-links/parser";

export async function saveImportDraftAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const draftId = String(formData.get("draftId") || "");
  const draft = draftId ? await prisma.importDraft.findUnique({ where: { id: draftId } }) : null;
  const saved = await saveConfirmedImportDraft(user, confirmedInputFromForm(formData, draft));

  revalidatePath("/");
  revalidatePath("/imports");
  revalidatePath(`/imports/${draftId}`);
  revalidatePath(`/word/${saved.word.slug}`);
  redirect(`/word/${saved.word.slug}?saved=import-draft`);
}

export async function bulkSaveImportDraftsAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const batch = parseBatchQuery(String(formData.get("batch") || ""));
  const filter = parseListFilter(String(formData.get("filter") || ""));
  const existing = parseExistingFilter(String(formData.get("existing") || ""));
  const images = parseImageFilter(String(formData.get("images") || ""));
  const draftIds = Array.from(
    new Set(
      formData
        .getAll("draftId")
        .map((value) => String(value).trim())
        .filter((value) => /^[a-z0-9]+$/i.test(value))
    )
  ).slice(0, 500);
  if (!draftIds.length) redirect(noSavableDraftsUrl({ batch, filter, existing, images }));

  const drafts = await prisma.importDraft.findMany({
    where: { id: { in: draftIds }, status: "DRAFT" },
    orderBy: { createdAt: "asc" }
  });
  if (!drafts.length) redirect(noSavableDraftsUrl({ batch, filter, existing, images }));

  const savedWords: string[] = [];
  for (const draft of drafts) {
    const saved = await saveConfirmedImportDraft(user, confirmedInputFromDraft(draft));
    savedWords.push(saved.word.slug);
  }

  revalidatePath("/");
  revalidatePath("/imports");
  for (const slug of savedWords) revalidatePath(`/word/${slug}`);
  const params = listReturnParams({ batch, filter, existing, images });
  params.set("bulkSaved", String(drafts.length));
  redirect(`/imports?${params.toString()}`);
}

export async function saveFilteredImportDraftsAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const batch = parseBatchQuery(String(formData.get("batch") || ""));
  const filter = parseListFilter(String(formData.get("filter") || ""));
  const images = parseImageFilter(String(formData.get("images") || ""));
  const returnFilters = { batch, filter: filter === "saved" ? "unsaved" : filter, existing: "without", images };
  if (filter === "saved") redirect(noSavableDraftsUrl(returnFilters));

  const draftIds = await readDraftIdsWithoutExistingCards({ batch, images });
  if (!draftIds.length) redirect(noSavableDraftsUrl(returnFilters));

  const drafts = await prisma.importDraft.findMany({
    where: { id: { in: draftIds }, status: "DRAFT" },
    orderBy: { createdAt: "asc" }
  });
  if (!drafts.length) redirect(noSavableDraftsUrl(returnFilters));

  const seenWords = new Set<string>();
  const savedWords: string[] = [];
  let skipped = 0;
  let failed = 0;

  for (const draft of drafts) {
    const wordKey = draft.word.trim().toLowerCase();
    if (!wordKey || seenWords.has(wordKey)) {
      skipped += 1;
      continue;
    }
    seenWords.add(wordKey);
    try {
      const saved = await saveConfirmedImportDraft(user, confirmedInputFromDraft(draft));
      savedWords.push(saved.word.slug);
    } catch (error) {
      failed += 1;
      console.error(`Failed to save import draft ${draft.id} (${draft.word})`, error);
    }
  }

  revalidatePath("/");
  revalidatePath("/imports");
  for (const slug of savedWords) revalidatePath(`/word/${slug}`);

  const params = listReturnParams(returnFilters);
  params.set("bulkSaved", String(savedWords.length));
  if (skipped) params.set("bulkSkipped", String(skipped));
  if (failed) params.set("bulkFailed", String(failed));
  redirect(`/imports?${params.toString()}`);
}

function noSavableDraftsUrl(filters: { batch: string; filter: string; existing: string; images: string }) {
  const params = listReturnParams(filters);
  params.set("noSavable", "1");
  return `/imports?${params.toString()}`;
}

export async function clearImportDraftListAction(formData: FormData) {
  await requireRole(UserRole.ADMIN);
  const batch = parseBatchQuery(String(formData.get("batch") || ""));
  const filter = parseListFilter(String(formData.get("filter") || ""));
  const existing = parseExistingFilter(String(formData.get("existing") || ""));
  const images = parseImageFilter(String(formData.get("images") || ""));
  const cleared = await discardMatchingImportDrafts({ batch, filter, existing, images });
  revalidatePath("/imports");
  const params = listReturnParams({ batch, filter, existing, images });
  params.set("cleared", String(cleared));
  redirect(`/imports${params.size ? `?${params.toString()}` : ""}`);
}

export async function undoImportDraftSaveAction(formData: FormData) {
  const user = await requireRole(UserRole.ADMIN);
  const batch = parseBatchQuery(String(formData.get("batch") || ""));
  const filter = parseListFilter(String(formData.get("filter") || ""));
  const existing = parseExistingFilter(String(formData.get("existing") || ""));
  const images = parseImageFilter(String(formData.get("images") || ""));
  const returnTo = String(formData.get("returnTo") || "imports");
  const draftIds = Array.from(
    new Set(
      formData
        .getAll("draftId")
        .map((value) => String(value).trim())
        .filter((value) => /^[a-z0-9]+$/i.test(value))
    )
  ).slice(0, 500);
  if (!draftIds.length) throw new Error("请选择要撤销的保存记录。");

  const result = await prisma.$transaction(async (tx) => {
    const drafts = await tx.importDraft.findMany({
      where: { id: { in: draftIds }, status: "SAVED", savedEntryId: { not: null } },
      orderBy: { createdAt: "asc" }
    });
    const affectedWords = new Map<string, { id: string; slug: string; word: string }>();
    let undone = 0;

    for (const draft of drafts) {
      if (!draft.savedEntryId) continue;
      const entry = await tx.mnemonicEntry.findUnique({
        where: { id: draft.savedEntryId },
        include: { targetWord: true }
      });

      if (entry) {
        affectedWords.set(entry.targetWordId, {
          id: entry.targetWordId,
          slug: entry.targetWord.slug,
          word: entry.targetWord.word
        });

        if (entry.status !== MnemonicStatus.ARCHIVED) {
          await tx.mnemonicEntryVersion.create({
            data: {
              mnemonicEntryId: entry.id,
              contentMarkdown: entry.contentMarkdown,
              splitText: entry.splitText,
              title: entry.title,
              editorId: user.id
            }
          });
          await tx.memoryLink.deleteMany({ where: { sourceMnemonicEntryId: entry.id } });
          await tx.mnemonicEntry.update({
            where: { id: entry.id },
            data: {
              status: MnemonicStatus.ARCHIVED,
              isPublic: false,
              isOfficialRecommended: false
            }
          });
        }
      }

      await tx.importDraft.update({
        where: { id: draft.id },
        data: { status: "DRAFT", savedWordId: null, savedEntryId: null }
      });
      undone += 1;

      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: "IMPORT_DRAFT_SAVE_UNDO",
          entityType: "ImportDraft",
          entityId: draft.id,
          metadataJson: { word: draft.word, entryId: draft.savedEntryId }
        }
      });
    }

    for (const word of affectedWords.values()) {
      const remaining = await tx.mnemonicEntry.findMany({
        where: {
          targetWordId: word.id,
          sourceType: MnemonicSourceType.OFFICIAL,
          status: { not: MnemonicStatus.ARCHIVED }
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }]
      });
      for (const [index, entry] of remaining.entries()) {
        if (entry.sortOrder !== index) {
          await tx.mnemonicEntry.update({ where: { id: entry.id }, data: { sortOrder: index } });
        }
      }
      if (!remaining.length) {
        await tx.word.update({
          where: { id: word.id },
          data: { status: WordStatus.NEEDS_REVISION }
        });
      }
    }

    return { undone, words: Array.from(affectedWords.values()) };
  });

  revalidatePath("/");
  revalidatePath("/imports");
  for (const word of result.words) revalidatePath(`/word/${word.slug}`);

  const params = listReturnParams({ batch, filter, existing, images });
  params.set("undone", String(result.undone));
  if (returnTo === "draft" && draftIds[0]) {
    redirect(`/imports/${draftIds[0]}${batch ? `?batch=${encodeURIComponent(batch)}&undone=${result.undone}` : `?undone=${result.undone}`}`);
  }
  redirect(`/imports?${params.toString()}`);
}

function confirmedInputFromForm(formData: FormData, draft: ImportDraft | null): ConfirmedImportInput {
  const wordText = String(formData.get("word") || "").trim().toLowerCase();
  if (!wordText) throw new Error("请填写要导入的单词。");
  const title = String(formData.get("title") || `${wordText} 记忆卡片`);
  const splitText = String(formData.get("splitText") || "");
  const relatedWords = parseRelatedWords(String(formData.get("relatedWords") || ""));
  const imageUrls = parseLines(String(formData.get("imageUrls") || ""));
  const contentMarkdown = buildConfirmedMarkdown({
    markdown: stripSplitLine(String(formData.get("contentMarkdown") || "")),
    imageUrls,
    relatedWords,
    importedImageUrls: draft?.extractedImageUrls ?? []
  });
  if (contentMarkdown.trim().length < 5) throw new Error("请填写记忆方法内容。");
  const incomingWord = {
    phoneticUk: String(formData.get("phoneticUk") || ""),
    phoneticUs: String(formData.get("phoneticUs") || ""),
    partOfSpeech: String(formData.get("partOfSpeech") || "n."),
    meaningCn: String(formData.get("meaningCn") || ""),
    meaningEn: String(formData.get("meaningEn") || ""),
    shortMeaningCn: String(formData.get("shortMeaningCn") || formData.get("meaningCn") || ""),
    exampleSentence: String(formData.get("exampleSentence") || ""),
    exampleTranslation: String(formData.get("exampleTranslation") || ""),
    difficulty: Number(formData.get("difficulty") || 3)
  };

  return {
    draft,
    wordText,
    title,
    splitText,
    relatedWords,
    imageUrls,
    contentMarkdown,
    incomingWord
  };
}

function confirmedInputFromDraft(draft: ImportDraft): ConfirmedImportInput {
  const agentPayload = draft.agentPayload as { relatedWords?: unknown; embeddedImages?: unknown } | null;
  const relatedWords = mergeRelatedWords(readStringArray(agentPayload?.relatedWords), extractWordLinks(draft.contentMarkdown));
  const imageUrls = readStringArray(agentPayload?.embeddedImages).length
    ? readStringArray(agentPayload?.embeddedImages)
    : draft.extractedImageUrls;
  return {
    draft,
    wordText: draft.word.trim().toLowerCase(),
    title: draft.title || `${draft.word} 记忆卡片`,
    splitText: draft.splitText || "",
    relatedWords,
    imageUrls,
    contentMarkdown: buildConfirmedMarkdown({
      markdown: stripSplitLine(draft.contentMarkdown),
      imageUrls,
      relatedWords,
      importedImageUrls: draft.extractedImageUrls
    }),
    incomingWord: {
      phoneticUk: draft.phoneticUk || "",
      phoneticUs: draft.phoneticUs || "",
      partOfSpeech: draft.partOfSpeech || "n.",
      meaningCn: draft.meaningCn || "",
      meaningEn: draft.meaningEn || "",
      shortMeaningCn: draft.shortMeaningCn || draft.meaningCn || "",
      exampleSentence: "",
      exampleTranslation: "",
      difficulty: draft.difficulty || 3
    }
  };
}

async function saveConfirmedImportDraft(user: User, input: ConfirmedImportInput) {
  if (!input.wordText) throw new Error("请填写要导入的单词。");
  if (input.contentMarkdown.trim().length < 5) throw new Error(`${input.wordText} 的记忆方法内容太短。`);
  const slug = slugify(input.wordText);
  const allRelatedWords = mergeRelatedWords(input.relatedWords, extractWordLinks(input.contentMarkdown));
  const relatedAutofills = await resolveRelatedWordAutofills(allRelatedWords, input.wordText);
  const contentHtml = await renderMnemonicMarkdown(input.contentMarkdown);
  const plainText = markdownToPlainText(input.contentMarkdown);

  return prisma.$transaction(async (tx) => {
    const existingWord = await tx.word.findUnique({ where: { word: input.wordText } });
    const wordSupplement = existingWord ? supplementEmptyWordFields(existingWord, input.incomingWord) : {};
    const word = existingWord
      ? Object.keys(wordSupplement).length
        ? await tx.word.update({
            where: { id: existingWord.id },
            data: wordSupplement
          })
        : existingWord
      : await tx.word.create({
          data: {
            word: input.wordText,
            slug,
            phoneticUk: input.incomingWord.phoneticUk,
            phoneticUs: input.incomingWord.phoneticUs,
            partOfSpeech: input.incomingWord.partOfSpeech || "n.",
            meaningCn: input.incomingWord.meaningCn,
            meaningEn: input.incomingWord.meaningEn,
            shortMeaningCn: input.incomingWord.shortMeaningCn || input.incomingWord.meaningCn,
            exampleSentence: input.incomingWord.exampleSentence,
            exampleTranslation: input.incomingWord.exampleTranslation,
            levelTags: [],
            difficulty: clampDifficulty(input.incomingWord.difficulty),
            status: WordStatus.PUBLISHED
          }
        });

    await ensureRelatedWords(allRelatedWords, word.word, tx, relatedAutofills);

    if (input.draft?.id) {
      await tx.importDraft.update({
        where: { id: input.draft.id },
        data: {
          word: word.word,
          phoneticUk: input.incomingWord.phoneticUk,
          phoneticUs: input.incomingWord.phoneticUs,
          partOfSpeech: input.incomingWord.partOfSpeech,
          meaningCn: input.incomingWord.meaningCn,
          meaningEn: input.incomingWord.meaningEn,
          shortMeaningCn: input.incomingWord.shortMeaningCn || input.incomingWord.meaningCn,
          difficulty: clampDifficulty(input.incomingWord.difficulty),
          splitText: input.splitText,
          title: input.title,
          contentMarkdown: input.contentMarkdown,
          extractedImageUrls: input.imageUrls,
          agentPayload: mergeSavedAgentPayload(input.draft.agentPayload, allRelatedWords, input.imageUrls)
        }
      });
    }

    const existing = input.draft?.savedEntryId
      ? await tx.mnemonicEntry.findUnique({ where: { id: input.draft.savedEntryId } })
      : null;

    if (existing) {
      await tx.mnemonicEntryVersion.create({
        data: {
          mnemonicEntryId: existing.id,
          contentMarkdown: existing.contentMarkdown,
          splitText: existing.splitText,
          title: existing.title,
          editorId: user.id
        }
      });
    }

    const entry = existing
      ? await tx.mnemonicEntry.update({
        where: { id: existing.id },
        data: {
            title: input.title,
            splitText: input.splitText,
            contentMarkdown: input.contentMarkdown,
            contentHtml,
            plainText,
            status: MnemonicStatus.APPROVED,
            isPublic: true,
            isOfficialRecommended: true
          }
        })
      : await tx.mnemonicEntry.create({
          data: {
            targetWordId: word.id,
            authorId: user.id,
            sourceType: MnemonicSourceType.OFFICIAL,
            status: MnemonicStatus.APPROVED,
            title: input.title,
            splitText: input.splitText,
            contentMarkdown: input.contentMarkdown,
            contentHtml,
            plainText,
            isPublic: true,
            isOfficialRecommended: true,
            sortOrder: await nextOfficialSortOrder(tx, word.id),
            editorScore: 8
          }
        });

    await ensureWordNode(word.id, tx);
    await syncEntryWikiLinks(entry.id, user.id, tx);

    if (input.draft?.id) {
      await tx.importDraft.update({
        where: { id: input.draft.id },
        data: { status: "SAVED", savedWordId: word.id, savedEntryId: entry.id }
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "IMPORT_DRAFT_SAVE",
        entityType: "ImportDraft",
        entityId: input.draft?.id || entry.id,
        metadataJson: { word: word.word, entryId: entry.id, relatedWords: allRelatedWords, imageUrls: input.imageUrls, updatedExistingEntry: Boolean(existing) }
      }
    });

    return { word, entry };
  });
}

export async function discardImportDraftAction(formData: FormData) {
  await requireRole(UserRole.ADMIN);
  const draftId = String(formData.get("draftId") || "");
  if (draftId) {
    await prisma.importDraft.update({ where: { id: draftId }, data: { status: "DISCARDED" } });
  }
  revalidatePath("/imports");
  redirect("/imports");
}

type IncomingWordFields = {
  phoneticUk: string;
  phoneticUs: string;
  partOfSpeech: string;
  meaningCn: string;
  meaningEn: string;
  shortMeaningCn: string;
  exampleSentence: string;
  exampleTranslation: string;
  difficulty: number;
};

type ConfirmedImportInput = {
  draft: ImportDraft | null;
  wordText: string;
  title: string;
  splitText: string;
  relatedWords: string[];
  imageUrls: string[];
  contentMarkdown: string;
  incomingWord: IncomingWordFields;
};

function supplementEmptyWordFields(existing: Word, incoming: IncomingWordFields): Prisma.WordUpdateInput {
  const data: Prisma.WordUpdateInput = {};
  setIfEmpty(data, existing, incoming, "phoneticUk");
  setIfEmpty(data, existing, incoming, "phoneticUs");
  setIfEmpty(data, existing, incoming, "partOfSpeech");
  setIfEmpty(data, existing, incoming, "meaningCn");
  setIfEmpty(data, existing, incoming, "meaningEn");
  setIfEmpty(data, existing, incoming, "shortMeaningCn");
  setIfEmpty(data, existing, incoming, "exampleSentence");
  setIfEmpty(data, existing, incoming, "exampleTranslation");
  if (existing.status === WordStatus.EMPTY) data.status = WordStatus.PUBLISHED;
  if (!existing.difficulty && incoming.difficulty) data.difficulty = clampDifficulty(incoming.difficulty);
  return data;
}

function setIfEmpty(
  data: Prisma.WordUpdateInput,
  existing: Word,
  incoming: IncomingWordFields,
  field: keyof IncomingWordFields
) {
  const next = incoming[field];
  if (typeof next !== "string" || !next.trim()) return;
  const current = existing[field as keyof Word];
  if (typeof current !== "string" || !current.trim()) {
    data[field as keyof Prisma.WordUpdateInput] = next as never;
  }
}

type RelatedWordAutofill = NonNullable<Awaited<ReturnType<typeof getWordAutofill>>>;

async function resolveRelatedWordAutofills(words: string[], currentWord: string) {
  const autofills = new Map<string, RelatedWordAutofill>();
  for (const relatedWord of words) {
    if (!shouldCreateRelatedWord(relatedWord, currentWord)) continue;
    const existing = await prisma.word.findUnique({ where: { word: relatedWord }, select: { id: true } });
    if (existing) continue;
    const autofill = await getWordAutofill(relatedWord).catch(() => null);
    if (autofill?.meaningCn) autofills.set(relatedWord, autofill);
  }
  return autofills;
}

async function ensureRelatedWords(
  words: string[],
  currentWord: string,
  tx: Prisma.TransactionClient,
  autofills: Map<string, RelatedWordAutofill>
) {
  for (const relatedWord of words) {
    if (!shouldCreateRelatedWord(relatedWord, currentWord)) continue;
    const existing = await tx.word.findUnique({ where: { word: relatedWord } });
    if (existing) {
      await ensureWordNode(existing.id, tx);
      continue;
    }
    const autofill = autofills.get(relatedWord);
    if (!autofill?.meaningCn) continue;
    const word = await tx.word.create({
      data: {
        word: relatedWord,
        slug: slugify(relatedWord),
        phoneticUk: autofill.phoneticUk,
        phoneticUs: autofill.phoneticUs,
        partOfSpeech: autofill.partOfSpeech || "n.",
        meaningCn: autofill.meaningCn,
        meaningEn: autofill.meaningEn,
        shortMeaningCn: autofill.shortMeaningCn || autofill.meaningCn,
        exampleSentence: autofill.exampleSentence,
        exampleTranslation: autofill.exampleTranslation,
        levelTags: [],
        difficulty: clampDifficulty(autofill.difficulty),
        status: WordStatus.EMPTY
      }
    });
    await ensureWordNode(word.id, tx);
  }
}

function shouldCreateRelatedWord(relatedWord: string, currentWord: string) {
  if (!relatedWord || relatedWord === currentWord) return false;
  return /^[a-z][a-z-]{1,38}$/i.test(relatedWord);
}

function buildConfirmedMarkdown({
  markdown,
  imageUrls,
  relatedWords,
  importedImageUrls
}: {
  markdown: string;
  imageUrls: string[];
  relatedWords: string[];
  importedImageUrls: string[];
}) {
  let content = stripTrailingRelatedWords(markdown);
  for (const url of importedImageUrls) {
    if (!imageUrls.includes(url)) content = removeMarkdownImage(content, url);
  }
  const missingImageMarkdown = imageUrls
    .filter((url) => url && !content.includes(url))
    .map((url) => `![示意图](${url})`)
    .join("\n\n");
  const relatedMarkdown = relatedWords.length
    ? ["相关单词：", ...relatedWords.map((word) => `[[word:${word}]]`)].join("\n")
    : "";
  return [content.trim(), missingImageMarkdown, relatedMarkdown].filter(Boolean).join("\n\n");
}

function stripTrailingRelatedWords(markdown: string) {
  return markdown.replace(/\n*相关单词[:：][\s\S]*$/u, "").trim();
}

function stripSplitLine(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:\*\*)?划分(?:\*\*)?\s*[:：]/u.test(line))
    .join("\n")
    .trim();
}

function removeMarkdownImage(markdown: string, url: string) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(new RegExp(`\\n*!\\[[^\\]]*\\]\\(${escaped}\\)\\n*`, "g"), "\n\n").trim();
}

function parseRelatedWords(input: string) {
  const words = input
    .split(/[\n,，;；\s]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.match(/\[\[word:([^|\]]+)/i)?.[1] ?? value)
    .map((value) => value.toLowerCase().replace(/[^a-z'-]/g, ""))
    .filter(Boolean);
  return Array.from(new Set(words));
}

function parseLines(input: string) {
  return Array.from(new Set(input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)));
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function parseBatchQuery(value: string) {
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[a-z0-9]+$/i.test(item));
  return ids.length ? Array.from(new Set(ids)).slice(0, 120).join(",") : "";
}

async function readDraftIdsWithoutExistingCards({ batch, images }: { batch: string; images: string }) {
  const batchIds = batch ? batch.split(",").filter((id) => /^[a-z0-9]+$/i.test(id)) : [];
  const batchSql = batchIds.length ? Prisma.sql`AND d.id IN (${Prisma.join(batchIds)})` : Prisma.empty;
  const imageSql =
    images === "none"
      ? Prisma.sql`AND cardinality(d."extractedImageUrls") = 0`
      : images === "one"
        ? Prisma.sql`AND cardinality(d."extractedImageUrls") = 1`
        : images === "multiple"
          ? Prisma.sql`AND cardinality(d."extractedImageUrls") > 1`
          : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`
      SELECT d.id
      FROM "ImportDraft" d
      WHERE d.status = 'DRAFT'
        ${batchSql}
        ${imageSql}
        AND NOT EXISTS (
          SELECT 1
          FROM "Word" w
          JOIN "MnemonicEntry" me
            ON me."targetWordId" = w.id
            AND me."sourceType" = 'OFFICIAL'
            AND me.status <> 'ARCHIVED'
          WHERE lower(w.word) = lower(d.word)
        )
      ORDER BY d."createdAt" ASC
    `
  );
  return rows.map((row) => row.id);
}

async function discardMatchingImportDrafts({
  batch,
  filter,
  existing,
  images
}: {
  batch: string;
  filter: string;
  existing: string;
  images: string;
}) {
  const batchIds = batch ? batch.split(",").filter((id) => /^[a-z0-9]+$/i.test(id)) : [];
  const batchSql = batchIds.length ? Prisma.sql`AND d.id IN (${Prisma.join(batchIds)})` : Prisma.empty;
  const statusSql =
    filter === "unsaved"
      ? Prisma.sql`AND d.status = 'DRAFT'`
      : filter === "saved"
        ? Prisma.sql`AND d.status = 'SAVED'`
        : Prisma.empty;
  const imageSql =
    images === "none"
      ? Prisma.sql`AND cardinality(d."extractedImageUrls") = 0`
      : images === "one"
        ? Prisma.sql`AND cardinality(d."extractedImageUrls") = 1`
        : images === "multiple"
          ? Prisma.sql`AND cardinality(d."extractedImageUrls") > 1`
          : Prisma.empty;
  const officialEntryExistsSql = Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "Word" w
      JOIN "MnemonicEntry" me
        ON me."targetWordId" = w.id
        AND me."sourceType" = 'OFFICIAL'
        AND me.status <> 'ARCHIVED'
      WHERE lower(w.word) = lower(d.word)
    )
  `;
  const existingSql =
    existing === "with"
      ? Prisma.sql`AND ${officialEntryExistsSql}`
      : existing === "without"
        ? Prisma.sql`AND NOT ${officialEntryExistsSql}`
        : Prisma.empty;

  return prisma.$executeRaw(
    Prisma.sql`
      UPDATE "ImportDraft" d
      SET status = 'DISCARDED', "updatedAt" = now()
      WHERE d.status <> 'DISCARDED'
        ${batchSql}
        ${statusSql}
        ${imageSql}
        ${existingSql}
    `
  );
}

function parseListFilter(value: string) {
  return value === "unsaved" || value === "saved" ? value : "";
}

function parseExistingFilter(value: string) {
  return value === "with" || value === "without" ? value : "";
}

function parseImageFilter(value: string) {
  return value === "none" || value === "one" || value === "multiple" ? value : "";
}

function listReturnParams({
  batch,
  filter,
  existing,
  images
}: {
  batch: string;
  filter: string;
  existing: string;
  images: string;
}) {
  const params = new URLSearchParams();
  if (batch) params.set("batch", batch);
  if (filter) params.set("filter", filter);
  if (existing) params.set("existing", existing);
  if (images) params.set("images", images);
  return params;
}

function extractWordLinks(markdown: string) {
  return parseWikiLinks(markdown)
    .filter((link) => link.namespace === "word")
    .map((link) => link.target.trim().toLowerCase())
    .filter(Boolean);
}

function mergeRelatedWords(first: string[], second: string[]) {
  return Array.from(new Set([...first, ...second]));
}

function mergeSavedAgentPayload(agentPayload: Prisma.JsonValue | null | undefined, relatedWords: string[], imageUrls: string[]) {
  const base = agentPayload && typeof agentPayload === "object" && !Array.isArray(agentPayload) ? agentPayload : {};
  return { ...base, relatedWords, embeddedImages: imageUrls };
}

function clampDifficulty(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

async function nextOfficialSortOrder(tx: Prisma.TransactionClient, wordId: string) {
  const latest = await tx.mnemonicEntry.findFirst({
    where: { targetWordId: wordId, sourceType: MnemonicSourceType.OFFICIAL, status: { not: MnemonicStatus.ARCHIVED } },
    orderBy: [{ sortOrder: "desc" }, { createdAt: "desc" }],
    select: { sortOrder: true }
  });
  return (latest?.sortOrder ?? -1) + 1;
}
