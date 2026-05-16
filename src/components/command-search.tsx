"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CommandSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  function submit() {
    if (q.trim()) {
      router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="hidden h-9 rounded-full px-3 text-xs text-foreground/75 hover:bg-muted hover:text-foreground md:inline-flex"
      >
        <Search className="h-4 w-4" />
        Ctrl K
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/35 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="mx-auto mt-24 max-w-xl rounded-lg border bg-card p-4 text-card-foreground shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 text-sm font-medium">搜索单词、中文释义、记忆节点</div>
            <div className="flex gap-2">
              <Input
                autoFocus
                value={q}
                placeholder="输入 abbreviation、词根或中文意思"
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && submit()}
                className="h-11 rounded-lg bg-background"
              />
              <Button type="button" onClick={submit} className="h-11 rounded-full px-5">
                搜索
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
