/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getUserWithRole } from "@/lib/auth/session";
import { saveImportDraftAction, discardImportDraftAction, undoImportDraftSaveAction } from "@/lib/services/import-draft-service";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownImageTextarea } from "@/components/markdown-image-textarea";
import { StatusBadge } from "@/components/status-badge";
import { WikiRichText } from "@/components/wiki-rich-text";
import { renderMnemonicMarkdown } from "@/lib/wiki-links/renderer";
import { parseWikiLinks } from "@/lib/wiki-links/parser";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function ImportDraftPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ batch?: string; undone?: string }>;
}) {
  const admin = await getUserWithRole(UserRole.ADMIN);
  if (!admin) notFound();

  const { id } = await params;
  const { batch, undone } = await searchParams;
  const batchQuery = parseBatchQuery(batch);
  const importsHref = batchQuery ? `/imports?batch=${encodeURIComponent(batchQuery)}` : "/imports";
  const draft = await prisma.importDraft.findUnique({ where: { id } });
  if (!draft) notFound();
  const previewHtml = await renderMnemonicMarkdown(draft.contentMarkdown);
  const agentPayload = draft.agentPayload as ImportAgentPayloadJson;
  const relatedWords = readRelatedWords(agentPayload, draft.contentMarkdown);
  const relatedWordLinks = uniqueRelatedWords(relatedWords);
  const relatedWordsHtml = relatedWordLinks.length
    ? await renderMnemonicMarkdown(relatedWordLinks.map((word) => `[[word:${word}]]`).join(" "))
    : "";
  const imageUrls = readStringArray(agentPayload?.embeddedImages).length
    ? readStringArray(agentPayload?.embeddedImages)
    : draft.extractedImageUrls;
  const warnings = readStringArray(agentPayload?.warnings);
  const confidence = typeof agentPayload?.confidence === "number" ? agentPayload.confidence : null;
  const existingWord = await prisma.word.findFirst({
    where: { word: { equals: draft.word, mode: "insensitive" } },
    select: {
      word: true,
      mnemonicEntries: {
        where: { sourceType: "OFFICIAL", status: { not: "ARCHIVED" } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          splitText: true,
          contentMarkdown: true,
          createdAt: true
        }
      }
    }
  });
  const existingEntries = (existingWord?.mnemonicEntries ?? []).filter((entry) => entry.id !== draft.savedEntryId);
  const existingCardCount = existingEntries.length;
  const existingEntryPreviews = await Promise.all(
    existingEntries.map(async (entry) => ({
      ...entry,
      html: await renderMnemonicMarkdown(entry.contentMarkdown)
    }))
  );

  return (
    <InteriorPage>
      <InteriorContainer wide>
      <Link href={importsHref} className="text-sm font-semibold text-[var(--mn-muted)] hover:text-[var(--mn-ink)]">← 返回导入草稿</Link>
      <InteriorHero
        eyebrow="confirm import"
        title={`确认导入：${draft.word}`}
        description="检查记忆方法、相关单词和图片，再决定是否写入正式卡片。"
        meta={<StatusBadge value={draft.status} />}
        className="mb-6 mt-4"
      />

      {existingCardCount ? (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          这个单词已经有 {existingCardCount} 张记忆卡。确认导入会追加一张新卡，不会覆盖已有卡片；单词信息只会补充空字段。
        </div>
      ) : null}
      {existingEntryPreviews.length ? (
        <section className="mb-5 rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">已有记忆卡</h2>
            <span className="text-sm text-muted-foreground">{existingEntryPreviews.length} 张</span>
          </div>
          <div className="grid gap-3">
            {existingEntryPreviews.map((entry, index) => (
              <details key={entry.id} className="rounded-lg border bg-background p-4" open={index === 0}>
                <summary className="cursor-pointer text-sm font-medium">
                  {entry.title || `${existingWord?.word ?? draft.word} 记忆卡片`}
                </summary>
                {entry.splitText ? <p className="mt-3 text-sm leading-6 text-muted-foreground">划分：{entry.splitText}</p> : null}
                <div className="mt-3 text-sm leading-7">
                  <WikiRichText html={entry.html} wordCardPopover />
                </div>
              </details>
            ))}
          </div>
        </section>
      ) : null}
      {undone ? (
        <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
          已撤销保存，草稿已恢复为未保存。
        </div>
      ) : null}
      {warnings.length || confidence !== null ? (
        <div className="mb-5 rounded-xl border bg-white p-4 text-sm leading-6 text-muted-foreground">
          {confidence !== null ? <p>识别置信度：{Math.round(confidence * 100)}%</p> : null}
          {warnings.map((warning) => <p key={warning}>提示：{warning}</p>)}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
          <header className="border-b p-5">
            <h2 className="text-5xl font-bold tracking-normal">{draft.word}</h2>
            <p className="mt-3 text-lg text-muted-foreground">{draft.phoneticUk || draft.phoneticUs}</p>
            <p className="mt-5 whitespace-pre-line text-2xl leading-10">{draft.meaningCn}</p>
          </header>
          <article className="p-5">
            <h3 className="text-2xl font-bold">记忆卡</h3>
            {draft.splitText ? <p className="mt-3 text-xl leading-9">划分：{draft.splitText}</p> : null}
            <div className="mt-2 text-xl leading-9">
              <WikiRichText html={previewHtml} wordCardPopover />
            </div>
          </article>
          {draft.originalImageUrl || draft.extractedImageUrls.length ? (
          <footer className="border-t p-5">
              <div className="mb-3 text-sm text-muted-foreground">图片</div>
              <div className="grid gap-3">
                {draft.originalImageUrl ? <img src={draft.originalImageUrl} alt="原始截图" className="max-h-80 rounded-lg border object-contain" /> : null}
                {draft.extractedImageUrls.map((url) => (
                  <img key={url} src={url} alt="提取图片" className="max-h-80 rounded-lg border object-contain" />
                ))}
              </div>
            </footer>
          ) : null}
        </section>

        <section className="space-y-6">
          {draft.status === "SAVED" && draft.savedEntryId ? (
            <form action={undoImportDraftSaveAction} className="rounded-xl border border-destructive/30 bg-card p-5 text-card-foreground shadow-sm">
              <input type="hidden" name="draftId" value={draft.id} />
              <input type="hidden" name="batch" value={batchQuery} />
              <input type="hidden" name="returnTo" value="draft" />
              <h2 className="text-lg font-semibold">撤销保存</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                归档这次保存生成的正式记忆卡，并把草稿恢复为未保存。
              </p>
              <Button variant="destructive" className="mt-4">一键撤销这次保存</Button>
            </form>
          ) : null}

          <form action={saveImportDraftAction} className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <input type="hidden" name="draftId" value={draft.id} />
            <input type="hidden" name="word" value={draft.word} />
            <input type="hidden" name="phoneticUk" value={draft.phoneticUk ?? ""} />
            <input type="hidden" name="phoneticUs" value={draft.phoneticUs ?? ""} />
            <input type="hidden" name="partOfSpeech" value={draft.partOfSpeech ?? ""} />
            <input type="hidden" name="meaningCn" value={draft.meaningCn ?? ""} />
            <input type="hidden" name="meaningEn" value={draft.meaningEn ?? ""} />
            <input type="hidden" name="shortMeaningCn" value={draft.shortMeaningCn ?? ""} />
            <input type="hidden" name="difficulty" value={draft.difficulty} />
            <input type="hidden" name="title" value={draft.title ?? `${draft.word} 记忆卡片`} />
            <input type="hidden" name="splitText" value={draft.splitText ?? ""} />
            <h2 className="text-lg font-semibold">确认导入</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              只检查记忆方法、相关单词和图片。词头信息使用词库已有数据；当前已有 {existingCardCount} 张记忆卡。
            </p>
            <div className="mt-4 grid gap-3">
              <MarkdownImageTextarea
                name="contentMarkdown"
                defaultValue={draft.contentMarkdown}
                className="min-h-[420px] font-mono leading-7"
              />
              <div className="grid gap-2">
                <label className="grid gap-2 text-sm font-medium">
                  <span>相关单词</span>
                  <Textarea
                    name="relatedWords"
                    defaultValue={relatedWords.join("\n")}
                    className="min-h-24 leading-7"
                    placeholder={"party\npart"}
                  />
                </label>
                {relatedWordsHtml ? (
                  <div className="rounded-lg border bg-muted/40 p-3 text-sm font-normal leading-7">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">链接预览</div>
                    <WikiRichText html={relatedWordsHtml} wordCardPopover />
                  </div>
                ) : null}
              </div>
              <label className="grid gap-2 text-sm font-medium">
                <span>插入图片路径</span>
                <Textarea
                  name="imageUrls"
                  defaultValue={imageUrls.join("\n")}
                  className="min-h-24 font-mono text-sm leading-7"
                  placeholder="/uploads/imports/xxx.png"
                />
              </label>
              {draft.originalImageUrl ? (
                <p className="text-xs leading-6 text-muted-foreground">
                  原始截图已保存：<code className="rounded bg-muted px-1">{draft.originalImageUrl}</code>
                </p>
              ) : null}
              <Button>确认保存到卡片库</Button>
            </div>
          </form>

          <form action={discardImportDraftAction} className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <input type="hidden" name="draftId" value={draft.id} />
            <h2 className="text-lg font-semibold">丢弃草稿</h2>
            <p className="mt-1 text-sm text-muted-foreground">只标记草稿为已丢弃，不会删除正式卡片。</p>
            <Button variant="outline">丢弃草稿</Button>
          </form>

          <div className="rounded-xl border bg-card p-5 text-card-foreground shadow-sm">
            <h2 className="text-lg font-semibold">Agent 原始文本</h2>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs">
              {draft.rawText || JSON.stringify(draft.agentPayload, null, 2)}
            </pre>
          </div>
        </section>
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}

type ImportAgentPayloadJson = {
  relatedWords?: unknown;
  embeddedImages?: unknown;
  confidence?: unknown;
  warnings?: unknown;
  exampleSentence?: unknown;
  exampleTranslation?: unknown;
} | null;

function readRelatedWords(payload: ImportAgentPayloadJson, markdown: string) {
  const fromPayload = readStringArray(payload?.relatedWords);
  if (fromPayload.length) return fromPayload;
  return Array.from(
    new Set(
      parseWikiLinks(markdown)
        .filter((link) => link.namespace === "word")
        .map((link) => link.target.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function uniqueRelatedWords(words: string[]) {
  return Array.from(
    new Set(
      words
        .map((word) => word.match(/\[\[word:([^|\]]+)/i)?.[1] ?? word)
        .map((word) => word.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function parseBatchQuery(value: string | undefined) {
  const ids = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => /^[a-z0-9]+$/i.test(item));
  return ids.length ? Array.from(new Set(ids)).slice(0, 120).join(",") : "";
}
