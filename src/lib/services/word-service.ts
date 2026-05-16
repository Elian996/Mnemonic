"use server";

import { LevelTag, Prisma, UserRole, WordStatus } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireRole, requireUser } from "@/lib/auth/session";
import { nodeSlug, slugify } from "@/lib/slug";
import { wordSchema } from "@/lib/validators";
import { ensureWordNode } from "@/lib/wiki-links/resolve";
import { vocabCategoryByTag } from "@/lib/vocab-categories";

export async function saveWordAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const levelTags = formData.getAll("levelTags").map(String) as LevelTag[];
  const meaningCn = String(formData.get("meaningCn") || "");
  const shortMeaningCn = String(formData.get("shortMeaningCn") || "") || shortMeaningFrom(meaningCn);
  const parsed = wordSchema.parse({
    id: String(formData.get("id") || "") || undefined,
    word: String(formData.get("word") || ""),
    slug: String(formData.get("slug") || "") || slugify(String(formData.get("word") ?? "")),
    phoneticUk: String(formData.get("phoneticUk") || ""),
    phoneticUs: String(formData.get("phoneticUs") || ""),
    audioUkUrl: String(formData.get("audioUkUrl") || ""),
    audioUsUrl: String(formData.get("audioUsUrl") || ""),
    partOfSpeech: String(formData.get("partOfSpeech") || "n."),
    meaningCn,
    meaningEn: String(formData.get("meaningEn") || ""),
    shortMeaningCn,
    exampleSentence: String(formData.get("exampleSentence") || ""),
    exampleTranslation: String(formData.get("exampleTranslation") || ""),
    levelTags,
    frequencyRank: formData.get("frequencyRank"),
    difficulty: formData.get("difficulty") || 3,
    status: formData.get("status") || WordStatus.EMPTY
  });
  const returnTo = String(formData.get("returnTo") || "admin");
  const previous = parsed.id ? await prisma.word.findUnique({ where: { id: parsed.id } }) : null;
  const data = { ...parsed, slug: parsed.slug ?? slugify(parsed.word) };

  const word = parsed.id
    ? await prisma.word.update({ where: { id: parsed.id }, data })
    : await prisma.word.upsert({ where: { word: parsed.word }, create: data, update: data });
  await ensureWordNode(word.id);
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: parsed.id ? "WORD_UPDATE" : "WORD_CREATE",
      entityType: "Word",
      entityId: word.id,
      metadataJson: {
        previous,
        next: data
      }
    }
  });
  revalidatePath(`/word/${word.slug}`);
  revalidatePath("/admin/words");
  revalidatePath("/");
  if (returnTo === "word") redirect(`/word/${word.slug}?saved=word`);
  redirect(`/admin/words/${word.id}?saved=1`);
}

export async function deleteWordAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const id = String(formData.get("id") ?? "");
  const deleted = await prisma.$transaction((tx) => deleteWordWithSnapshot(tx, {
    actorId: user.id,
    wordId: id,
    action: "WORD_DELETE"
  }));
  if (deleted?.slug) revalidatePath(`/word/${deleted.slug}`);
  revalidatePath("/");
  revalidatePath("/repository");
  revalidatePath("/admin/words");
  redirect("/admin/words?deleted=1");
}

export async function deleteWordFromRepositoryAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const id = String(formData.get("id") ?? "");
  const returnTo = repositoryReturnTarget(String(formData.get("returnTo") ?? ""));
  const deleted = await prisma.$transaction((tx) => deleteWordWithSnapshot(tx, {
    actorId: user.id,
    wordId: id,
    action: "WORD_DELETE_FROM_REPOSITORY"
  }));
  if (!deleted) redirect(withDeletedFlag(returnTo, 0));

  revalidatePath("/");
  revalidatePath("/repository");
  revalidatePath(`/word/${deleted.slug}`);
  for (const tag of deleted.levelTags) {
    const category = vocabCategoryByTag[tag];
    if (category) revalidatePath(category.href);
  }
  redirect(withDeletedFlag(returnTo, 1));
}

export async function bulkDeleteWordsFromRepositoryAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const returnTo = repositoryReturnTarget(String(formData.get("returnTo") ?? ""));
  const ids = uniqueStrings(formData.getAll("wordId").map(String));
  if (!ids.length) redirect(returnTo);

  const deletedWords = await prisma.$transaction(async (tx) => {
    const deleted: Array<{ slug: string; levelTags: LevelTag[] }> = [];
    for (const id of ids) {
      const word = await deleteWordWithSnapshot(tx, {
        actorId: user.id,
        wordId: id,
        action: "WORD_BULK_DELETE_FROM_REPOSITORY"
      });
      if (word) deleted.push(word);
    }
    return deleted;
  });

  revalidatePath("/");
  revalidatePath("/repository");
  for (const word of deletedWords) revalidatePath(`/word/${word.slug}`);
  for (const tag of uniqueStrings(deletedWords.flatMap((word) => word.levelTags))) {
    const category = vocabCategoryByTag[tag as LevelTag];
    if (category) revalidatePath(category.href);
  }
  redirect(withDeletedFlag(returnTo, deletedWords.length));
}

function repositoryReturnTarget(value: string) {
  if (!value || !value.startsWith("/repository") || value.startsWith("//")) return "/repository";
  return value;
}

function withDeletedFlag(path: string, count = 1) {
  const [pathnameAndQuery, hash = ""] = path.split("#", 2);
  const [pathname, queryString = ""] = pathnameAndQuery.split("?", 2);
  const query = new URLSearchParams(queryString);
  query.set("deleted", String(count));
  const next = `${pathname}${query.size ? `?${query.toString()}` : ""}`;
  return hash ? `${next}#${hash}` : next;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function deleteWordWithSnapshot(
  tx: Prisma.TransactionClient,
  {
    actorId,
    wordId,
    action
  }: {
    actorId: string;
    wordId: string;
    action: string;
  }
) {
  const snapshot = await tx.word.findUnique({
    where: { id: wordId },
    include: {
      mnemonicEntries: {
        include: {
          versions: true,
          links: true,
          votes: true,
          bookmarks: true,
          reports: true,
          reviewCards: true,
          reviewLogs: true,
          userCardOrders: true
        }
      },
      bookmarks: true,
      reviewCards: true,
      reviewLogs: true,
      wordMarks: true,
      mnemonicCardOrders: true
    }
  });
  if (!snapshot) return null;

  await tx.word.delete({ where: { id: wordId } });
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entityType: "Word",
      entityId: wordId,
      metadataJson: toJsonSnapshot({
        word: snapshot,
        deletedAt: new Date().toISOString()
      })
    }
  });

  return { slug: snapshot.slug, levelTags: snapshot.levelTags };
}

function toJsonSnapshot(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export async function importWordsCsvAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const dryRun = formData.get("dryRun") === "on";
  const csv = String(formData.get("csv") ?? "");
  const rows = parseCsv(csv);
  const errors: string[] = [];
  let upserted = 0;

  for (const [index, row] of rows.entries()) {
    try {
      const levelTags = (row.levelTags ?? "")
        .split("|")
        .map((tag) => tag.trim())
        .filter(Boolean) as LevelTag[];
      const parsed = wordSchema.parse({
        word: row.word,
        slug: slugify(row.word),
        phoneticUk: row.phoneticUk,
        phoneticUs: row.phoneticUs,
        partOfSpeech: row.partOfSpeech || "n.",
        meaningCn: row.meaningCn,
        meaningEn: row.meaningEn,
        shortMeaningCn: row.shortMeaningCn || row.meaningCn,
        levelTags,
        frequencyRank: row.frequencyRank || "",
        difficulty: row.difficulty || 3,
        status: WordStatus.EMPTY
      });
      if (!dryRun) {
        const data = { ...parsed, slug: parsed.slug ?? slugify(parsed.word) };
        const word = await prisma.word.upsert({
          where: { word: parsed.word },
          create: data,
          update: data
        });
        await ensureWordNode(word.id);
      }
      upserted += 1;
    } catch (error) {
      errors.push(`第 ${index + 2} 行：${error instanceof Error ? error.message : "格式错误"}`);
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      action: dryRun ? "WORD_IMPORT_DRY_RUN" : "WORD_IMPORT",
      entityType: "Word",
      entityId: "CSV",
      metadataJson: { upserted, errors }
    }
  });

  revalidatePath("/admin/words");
  redirect(`/admin/words?imported=${upserted}&errors=${errors.length}`);
}

export async function saveNodeAction(formData: FormData) {
  await requireRole(UserRole.EDITOR);
  const type = String(formData.get("type")) as never;
  const value = String(formData.get("value") ?? "");
  const id = String(formData.get("id") || "");
  await prisma.memoryNode.upsert({
    where: { id: id || "__new__" },
    create: {
      type,
      value,
      slug: nodeSlug(value),
      displayName: String(formData.get("displayName") || value),
      meaningCn: String(formData.get("meaningCn") || ""),
      description: String(formData.get("description") || "")
    },
    update: {
      type,
      value,
      slug: nodeSlug(value),
      displayName: String(formData.get("displayName") || value),
      meaningCn: String(formData.get("meaningCn") || ""),
      description: String(formData.get("description") || "")
    }
  });
  revalidatePath("/admin/nodes");
}

export async function mergeNodesAction(formData: FormData) {
  const user = await requireRole(UserRole.EDITOR);
  const fromId = String(formData.get("fromId") ?? "");
  const toId = String(formData.get("toId") ?? "");
  if (!fromId || !toId) throw new Error("请选择要合并的节点。");
  if (fromId === toId) throw new Error("不能把节点合并到自己。");

  await prisma.$transaction(async (tx) => {
    const [fromNode, toNode] = await Promise.all([
      tx.memoryNode.findUnique({ where: { id: fromId } }),
      tx.memoryNode.findUnique({ where: { id: toId } })
    ]);
    if (!fromNode || !toNode) throw new Error("节点不存在。");

    await tx.memoryLink.updateMany({ where: { sourceNodeId: fromId }, data: { sourceNodeId: toId } });
    await tx.memoryLink.updateMany({ where: { targetNodeId: fromId }, data: { targetNodeId: toId } });
    await tx.memoryChainItem.updateMany({ where: { nodeId: fromId }, data: { nodeId: toId } });
    await tx.memoryNode.delete({ where: { id: fromId } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        action: "MEMORY_NODE_MERGE",
        entityType: "MemoryNode",
        entityId: fromId,
        metadataJson: toJsonSnapshot({ fromNode, toNode })
      }
    });
  });
  revalidatePath("/admin/nodes");
}

export async function updateUserAdminAction(formData: FormData) {
  await requireRole(UserRole.ADMIN);
  await prisma.user.update({
    where: { id: String(formData.get("userId") ?? "") },
    data: {
      role: String(formData.get("role")) as never,
      status: String(formData.get("status")) as never
    }
  });
  revalidatePath("/admin/users");
}

export async function suspendReportedUserAction(formData: FormData) {
  await requireRole(UserRole.ADMIN);
  await prisma.user.update({
    where: { id: String(formData.get("userId") ?? "") },
    data: { status: "SUSPENDED" }
  });
  revalidatePath("/admin/users");
  revalidatePath("/admin/reports");
}

export async function exportWordsCsv() {
  await requireUser();
  const words = await prisma.word.findMany({ orderBy: { word: "asc" } });
  return [
    "word,phoneticUk,phoneticUs,partOfSpeech,meaningCn,meaningEn,shortMeaningCn,levelTags,frequencyRank,difficulty",
    ...words.map((word) =>
      [
        word.word,
        word.phoneticUk ?? "",
        word.phoneticUs ?? "",
        word.partOfSpeech,
        word.meaningCn,
        word.meaningEn ?? "",
        word.shortMeaningCn,
        word.levelTags.join("|"),
        word.frequencyRank ?? "",
        word.difficulty
      ]
        .map(csvEscape)
        .join(",")
    )
  ].join("\n");
}

function parseCsv(csv: string) {
  const [headerLine, ...lines] = csv.trim().split(/\r?\n/);
  const headers = splitCsvLine(headerLine);
  return lines.filter(Boolean).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function splitCsvLine(line: string) {
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
  return result.map((item) => item.trim());
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function shortMeaningFrom(meaningCn: string) {
  return meaningCn.split(/[；;，,\n]/)[0]?.trim() || meaningCn.trim() || "未填写";
}
