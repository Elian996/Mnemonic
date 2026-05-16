"use client";

import * as React from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type MarkdownImageTextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  statusClassName?: string;
};

export function MarkdownImageTextarea({
  value,
  defaultValue = "",
  onValueChange,
  className,
  statusClassName,
  onPaste,
  ...props
}: MarkdownImageTextareaProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const [status, setStatus] = React.useState("");
  const currentValue = value ?? internalValue;

  function updateValue(nextValue: string) {
    if (value === undefined) setInternalValue(nextValue);
    onValueChange?.(nextValue);
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    onPaste?.(event);
    if (event.defaultPrevented) return;

    const imageFile = findPastedImage(event.clipboardData);
    const imageUrl = imageFile ? "" : findPastedImageUrl(event.clipboardData);
    if (!imageFile && !imageUrl) return;

    event.preventDefault();
    setStatus("正在保存粘贴的图片...");

    try {
      const formData = new FormData();
      if (imageFile) {
        formData.append("image", imageFile, imageFile.name || "pasted-image.png");
      } else {
        formData.append("imageUrl", imageUrl);
      }
      const response = await fetch("/api/uploads/image", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || "图片上传失败");

      const markdown = `\n\n![记忆图](${result.url})\n\n`;
      insertAtCursor(markdown);
      setStatus("图片已插入。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "图片上传失败。");
    }
  }

  function insertAtCursor(markdown: string) {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const nextValue = `${currentValue.slice(0, selectionStart)}${markdown}${currentValue.slice(selectionEnd)}`;
    updateValue(nextValue);

    window.requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = selectionStart + markdown.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="grid gap-2">
      <Textarea
        {...props}
        ref={textareaRef}
        value={currentValue}
        onChange={(event) => updateValue(event.target.value)}
        onPaste={handlePaste}
        className={className}
      />
      {status ? (
        <p className={cn("text-xs leading-5 text-muted-foreground", statusClassName)}>{status}</p>
      ) : null}
    </div>
  );
}

function findPastedImage(clipboardData: DataTransfer) {
  const item = Array.from(clipboardData.items).find((clipboardItem) => clipboardItem.type.startsWith("image/"));
  const fileFromItem = item?.getAsFile();
  if (fileFromItem) return fileFromItem;
  return Array.from(clipboardData.files).find((file) => file.type.startsWith("image/"));
}

function findPastedImageUrl(clipboardData: DataTransfer) {
  const html = clipboardData.getData("text/html");
  if (html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const src = doc.querySelector("img")?.getAttribute("src")?.trim();
    if (src) return src;
  }

  const text = clipboardData.getData("text/plain").trim();
  if (/^data:image\//i.test(text)) return text;
  if (/^https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:[?#]\S*)?$/i.test(text)) return text;
  return "";
}
