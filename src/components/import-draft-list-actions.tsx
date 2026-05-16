"use client";

import { useEffect } from "react";
import { CheckSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

const SELECTED_DRAFTS_STORAGE_KEY_PREFIX = "mnemonic:selected-import-drafts:";

export function ImportDraftListActions({
  selectableCount,
  storageKey,
  initialSelectedIds = []
}: {
  selectableCount: number;
  storageKey: string;
  initialSelectedIds?: string[];
}) {
  useEffect(() => {
    const key = scopedStorageKey(storageKey);
    const inputs = readDraftCheckboxes();
    const stored = readSelectedDraftIds(key);
    const selected = stored ?? new Set(initialSelectedIds);
    inputs.forEach((input) => {
      input.checked = selected.has(input.value);
    });
    writeSelectedDraftIds(key, selected);

    function onChange(event: Event) {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.importDraftCheckbox !== "true") return;
      const next = readSelectedDraftIds(key) ?? new Set<string>();
      if (target.checked) {
        next.add(target.value);
      } else {
        next.delete(target.value);
      }
      writeSelectedDraftIds(key, next);
    }

    document.addEventListener("change", onChange);
    return () => document.removeEventListener("change", onChange);
  }, [initialSelectedIds, storageKey]);

  function setAll(checked: boolean) {
    const key = scopedStorageKey(storageKey);
    const selected = readSelectedDraftIds(key) ?? new Set<string>();
    readDraftCheckboxes().forEach((input) => {
      input.checked = checked;
      if (checked) {
        selected.add(input.value);
      } else {
        selected.delete(input.value);
      }
    });
    writeSelectedDraftIds(key, selected);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" onClick={() => setAll(true)} disabled={!selectableCount} className="rounded-full">
        <CheckSquare className="h-4 w-4" />
        全选本页未保存
      </Button>
      <Button type="button" variant="ghost" onClick={() => setAll(false)} disabled={!selectableCount} className="rounded-full">
        <Square className="h-4 w-4" />
        取消勾选
      </Button>
    </div>
  );
}

function readDraftCheckboxes() {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[data-import-draft-checkbox="true"]:not(:disabled)')
  );
}

function scopedStorageKey(key: string) {
  return `${SELECTED_DRAFTS_STORAGE_KEY_PREFIX}${key}`;
}

function readSelectedDraftIds(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (stored === null) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return new Set<string>();
    return new Set(parsed.map((item) => String(item)).filter((item) => /^[a-z0-9]+$/i.test(item)));
  } catch {
    return new Set<string>();
  }
}

function writeSelectedDraftIds(key: string, selected: Set<string>) {
  if (typeof window === "undefined") return;
  const ids = Array.from(selected).filter((item) => /^[a-z0-9]+$/i.test(item));
  if (ids.length) {
    window.sessionStorage.setItem(key, JSON.stringify(ids));
  } else {
    window.sessionStorage.removeItem(key);
  }
}
