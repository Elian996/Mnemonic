"use client";

import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";
import { parseWikiLinks } from "@/lib/wiki-links/parser";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MarkdownImageTextarea } from "@/components/markdown-image-textarea";

type Props = {
  action: (formData: FormData) => void | Promise<void>;
  targetWordId: string;
  entry?: {
    id: string;
    title: string;
    splitText: string | null;
    contentMarkdown: string;
    status: string;
    updatedKey?: string;
    editorScore?: number;
    isOfficialRecommended?: boolean;
  };
  mode: "official" | "private" | "public";
  returnTo?: "admin" | "word" | "mine";
  showVisibilityChoice?: boolean;
};

export function MnemonicEditor({ action, targetWordId, entry, mode, returnTo = "admin", showVisibilityChoice = false }: Props) {
  const [content, setContent] = useState(() => editableContent(entry?.contentMarkdown, entry?.splitText));
  const [relatedWords, setRelatedWords] = useState(() => relatedWordText(entry?.contentMarkdown ?? ""));
  const [visibilityMode, setVisibilityMode] = useState<"private" | "public">(() => (mode === "public" ? "public" : "private"));
  const splitText = useMemo(() => readSplitText(content), [content]);
  const finalContent = useMemo(() => withRelatedWordLinks(stripSplitLine(content), relatedWords), [content, relatedWords]);
  const publicReminder =
    mode !== "official" && visibilityMode === "public"
      ? entry?.status === "APPROVED" || entry?.status === "FEATURED"
        ? "提醒：修改已公开记忆卡后会重新进入审核，通过前新内容不会对外展示；审核结果会发送到个人中心收件箱。"
        : "提醒：提交公开后需等待管理员审核，通过后才会展示；审核结果会发送到个人中心收件箱。"
      : "";

  useEffect(() => {
    setContent(editableContent(entry?.contentMarkdown, entry?.splitText));
    setRelatedWords(relatedWordText(entry?.contentMarkdown ?? ""));
  }, [entry?.id, entry?.updatedKey, entry?.contentMarkdown, entry?.splitText]);

  useEffect(() => {
    setVisibilityMode(mode === "public" ? "public" : "private");
  }, [mode]);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="targetWordId" value={targetWordId} />
      <input type="hidden" name="mode" value={mode === "official" ? "private" : visibilityMode} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <input type="hidden" name="contentMarkdown" value={finalContent} />
      <input type="hidden" name="title" value="助记内容" />
      <input type="hidden" name="splitText" value={splitText} />
      {entry?.id ? <input type="hidden" name="id" value={entry.id} /> : null}
      <div className="space-y-4">
        <MarkdownImageTextarea
          value={content}
          onValueChange={setContent}
          className="min-h-[520px] rounded-[28px] border-[#d2d7e2] p-7 text-lg leading-9 shadow-sm"
          placeholder={DEFAULT_MNEMONIC_TEMPLATE}
          required
        />
        <Input
          value={relatedWords}
          onChange={(event) => setRelatedWords(event.target.value)}
          className="h-14 rounded-2xl border-[#d2d7e2] text-base shadow-sm"
          placeholder="相关单词，用逗号分隔，例如 inspect, suspect, expect"
        />
        {showVisibilityChoice && mode !== "official" ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-[#d2d7e2] bg-white/60 px-3 py-2 text-sm font-semibold dark:border-border dark:bg-card/60">
            <span className="text-[var(--mn-muted)]">保存为</span>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                checked={visibilityMode === "private"}
                onChange={() => setVisibilityMode("private")}
                className="h-4 w-4 accent-[var(--mn-ink)]"
              />
              私有
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="radio"
                checked={visibilityMode === "public"}
                onChange={() => setVisibilityMode("public")}
                className="h-4 w-4 accent-[var(--mn-ink)]"
              />
              公开审核
            </label>
          </div>
        ) : null}
        {publicReminder ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
            <Info className="mt-1 h-4 w-4 shrink-0" />
            <span>{publicReminder}</span>
          </div>
        ) : null}
        {mode === "official" ? (
          <>
            <input type="hidden" name="status" value="APPROVED" />
            <input type="hidden" name="editorScore" value={entry?.editorScore ?? 8} />
            <input type="hidden" name="isOfficialRecommended" value="on" />
          </>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit">{mode === "official" ? "保存官方助记" : visibilityMode === "public" ? "提交审核" : "保存我的助记"}</Button>
          <span className="self-center text-sm text-muted-foreground">保存会保留上一版内容</span>
        </div>
      </div>
    </form>
  );
}

function withRelatedWordLinks(content: string, relatedWords: string) {
  const words = relatedWords
    .split(/[,，\s]+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  const cleanContent = stripRelatedWordBlock(content);
  if (!words.length) return cleanContent;
  const linkBlock = ["", "相关单词：", ...Array.from(new Set(words)).map((word) => `[[word:${word}]]`)].join("\n");
  return `${cleanContent.trimEnd()}\n${linkBlock}`;
}

const DEFAULT_MNEMONIC_TEMPLATE = "划分：\n\n带你背：\n\n例句：";

function editableContent(markdown?: string, splitText?: string | null) {
  const content = stripRelatedWordBlock(markdown ?? DEFAULT_MNEMONIC_TEMPLATE).trim();
  if (hasSplitLine(content)) return content;
  const splitLine = `划分：${splitText?.trim() ? ` ${splitText.trim()}` : ""}`;
  return [splitLine, content].filter(Boolean).join("\n\n");
}

function relatedWordText(markdown: string) {
  return Array.from(
    new Set(
      parseWikiLinks(markdown)
        .filter((link) => link.nodeType === "WORD" || link.namespace === "word")
        .map((link) => link.target.trim().toLowerCase())
        .filter(Boolean)
    )
  ).join(", ");
}

function stripRelatedWordBlock(markdown: string) {
  return markdown.replace(/\n*相关单词[:：][\s\S]*$/u, "").trimEnd();
}

function readSplitText(markdown: string) {
  return markdown.match(/^\s*划分\s*[:：]\s*(.+?)\s*$/mu)?.[1]?.trim() ?? "";
}

function hasSplitLine(markdown: string) {
  return /^\s*划分\s*[:：]/mu.test(markdown);
}

function stripSplitLine(markdown: string) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => !/^\s*划分\s*[:：]/u.test(line))
    .join("\n")
    .trim();
}
