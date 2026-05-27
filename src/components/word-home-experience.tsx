"use client";

import Link from "next/link";
import { Check, ChevronRight, Dice5, Eye, EyeOff, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type HomeWord = {
  id: string;
  word: string;
  slug: string;
  phonetic: string;
  meaningCn: string;
  mnemonic: string;
};

export type HomeCategory = {
  tag: string;
  label: string;
  shortLabel: string;
  description: string;
  count: number;
  words: HomeWord[];
};

type WordHomeExperienceProps = {
  wordCount: number;
  categories: HomeCategory[];
};

type MarkState = "known" | "soft" | "unknown";

export function WordHomeExperience({ wordCount, categories }: WordHomeExperienceProps) {
  const [selectedTag, setSelectedTag] = useState<string | null>(categories[0]?.tag ?? null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [reveal, setReveal] = useState(false);
  const [knownWords, setKnownWords] = useState<string[]>([]);
  const [reviewWords, setReviewWords] = useState<string[]>([]);
  const [memoryWord, setMemoryWord] = useState<HomeWord | null>(null);
  const [notice, setNotice] = useState("");

  const allWords = useMemo(() => {
    const wordMap = new Map<string, HomeWord>();
    categories.forEach((category) => category.words.forEach((word) => wordMap.set(word.id, word)));
    return Array.from(wordMap.values());
  }, [categories]);

  const selectedCategory = categories.find((category) => category.tag === selectedTag) ?? null;
  const sessionWords = (selectedCategory?.words.length ? selectedCategory.words : allWords).slice(0, 18);
  const activeWord = sessionWords[Math.min(activeIndex, Math.max(sessionWords.length - 1, 0))] ?? null;
  const current = sessionWords.length ? Math.min(activeIndex + 1, sessionWords.length) : 0;
  const progress = sessionWords.length ? Math.round(((knownWords.length + reviewWords.length) / sessionWords.length) * 100) : 0;
  const reviewQueue = sessionWords.filter((word) => reviewWords.includes(word.id));

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1600);
  };

  const selectCategory = (tag: string | null) => {
    setSelectedTag(tag);
    setActiveIndex(0);
    setReveal(false);
    flash(tag ? "已切换范围" : "已切换全词库");
  };

  const nextWord = () => {
    if (!sessionWords.length) return;
    setActiveIndex((index) => (index + 1) % sessionWords.length);
    setReveal(false);
  };

  const pickRandom = () => {
    if (!allWords.length) return;
    const word = allWords[Math.floor(Math.random() * allWords.length)];
    const source = categories.find((category) => category.words.some((item) => item.id === word.id));
    if (source) {
      setSelectedTag(source.tag);
      setActiveIndex(Math.max(0, source.words.findIndex((item) => item.id === word.id)));
    }
    setMemoryWord(word);
    flash(`抽到 ${word.word}`);
  };

  const markWord = (word: HomeWord, state: MarkState) => {
    setKnownWords((items) => items.filter((id) => id !== word.id));
    setReviewWords((items) => items.filter((id) => id !== word.id));

    if (state === "known") {
      setKnownWords((items) => [...items, word.id]);
      flash(`${word.word} 已掌握`);
      nextWord();
      return;
    }

    setReviewWords((items) => [...items, word.id]);
    setMemoryWord(word);
    setReveal(true);
    flash(state === "soft" ? `${word.word} 加入复习` : `${word.word} 打开记忆`);
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#f6f2ea] text-[#171717]">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-5 sm:px-8 lg:px-10">
        <Header wordCount={wordCount} onRandom={pickRandom} />

        <section className="grid min-w-0 max-w-full flex-1 gap-8 py-8 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12 lg:py-12">
          <ScopePanel
            categories={categories}
            selectedTag={selectedTag}
            progress={progress}
            current={current}
            total={sessionWords.length}
            onSelect={selectCategory}
          />

          <div className="min-w-0">
            <StudyPanel
              word={activeWord}
              category={selectedCategory}
              reveal={reveal}
              current={current}
              total={sessionWords.length}
              onToggleReveal={() => setReveal((value) => !value)}
              onMark={markWord}
              onNext={nextWord}
            />

            <QueuePanel
              words={sessionWords}
              reviewQueue={reviewQueue}
              activeWordId={activeWord?.id}
              onOpen={(word) => {
                setActiveIndex(sessionWords.findIndex((item) => item.id === word.id));
                setReveal(false);
              }}
            />
          </div>
        </section>
      </div>

      {notice ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-[#171717] px-4 py-2 text-sm font-bold text-[#fffaf0] shadow-xl">
          {notice}
        </div>
      ) : null}

      {memoryWord ? <MemoryModal word={memoryWord} onClose={() => setMemoryWord(null)} onNext={nextWord} /> : null}
    </main>
  );
}

function Header({ wordCount, onRandom }: { wordCount: number; onRandom: () => void }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[#171717]/15 pb-5">
      <Link href="/" className="flex min-w-0 items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 overflow-hidden rounded-sm bg-[#f8f1e3] ring-1 ring-[#171717]/15">
          <img src="/mnemonic-logo.png" alt="mnemonic" className="h-full w-full scale-[1.45] object-cover object-center" />
        </span>
        <span className="min-w-0">
          <span className="block text-xl font-black tracking-normal">mnemonic</span>
          <span className="block text-xs font-bold text-[#5f6868]">{wordCount.toLocaleString("zh-CN")} words</span>
        </span>
      </Link>

      <nav className="flex items-center gap-1.5">
        <IconLink href="/search" label="搜索">
          <Search className="h-4 w-4" />
        </IconLink>
        <button
          type="button"
          onClick={onRandom}
          aria-label="随机抽词"
          className="flex h-10 w-10 items-center justify-center rounded-sm bg-[#171717] text-[#fffaf0] transition hover:bg-[#2b2925]"
        >
          <Dice5 className="h-4 w-4" />
        </button>
      </nav>
    </header>
  );
}

function IconLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-sm border border-[#171717]/15 bg-[#fffaf0]/70 transition hover:border-[#171717]/40"
    >
      {children}
    </Link>
  );
}

function ScopePanel({
  categories,
  selectedTag,
  progress,
  current,
  total,
  onSelect
}: {
  categories: HomeCategory[];
  selectedTag: string | null;
  progress: number;
  current: number;
  total: number;
  onSelect: (tag: string | null) => void;
}) {
  return (
    <aside className="min-w-0 max-w-full overflow-hidden lg:sticky lg:top-8 lg:h-fit">
      <div className="flex items-end justify-between gap-4 lg:block">
        <div>
          <p className="text-xs font-black uppercase tracking-normal text-[#5f6868]">session</p>
          <div className="mt-2 text-4xl font-black tracking-normal">{progress}%</div>
          <p className="mt-1 text-sm font-bold text-[#5f6868]">
            {current}/{total || 0}
          </p>
        </div>
        <button type="button" onClick={() => onSelect(null)} className="text-sm font-black text-[#2f6570] hover:text-[#171717]">
          全词库
        </button>
      </div>

      <div className="mt-6 flex w-full max-w-full gap-2 overflow-x-auto pb-1 lg:block lg:space-y-2">
        {categories.map((category) => (
          <button
            key={category.tag}
            type="button"
            onClick={() => onSelect(category.tag)}
            className={cn(
              "group flex min-w-[132px] items-center justify-between gap-4 border-b-2 px-0 py-3 text-left transition lg:w-full",
              selectedTag === category.tag ? "border-[#171717]" : "border-[#171717]/10 hover:border-[#171717]/35"
            )}
          >
            <span className="min-w-0">
              <span className="block truncate text-base font-black">{category.shortLabel || category.label}</span>
              <span className="block text-xs font-bold text-[#5f6868]">{category.count.toLocaleString("zh-CN")} 词</span>
            </span>
            <span className={cn("h-3 w-3 shrink-0 rounded-sm", selectedTag === category.tag ? "bg-[#2f6570]" : "bg-[#d8a92f]")} />
          </button>
        ))}
      </div>
    </aside>
  );
}

function StudyPanel({
  word,
  category,
  reveal,
  current,
  total,
  onToggleReveal,
  onMark,
  onNext
}: {
  word: HomeWord | null;
  category: HomeCategory | null;
  reveal: boolean;
  current: number;
  total: number;
  onToggleReveal: () => void;
  onMark: (word: HomeWord, state: MarkState) => void;
  onNext: () => void;
}) {
  if (!word) {
    return <div className="border border-[#171717]/15 bg-[#fffaf0]/70 p-10 text-center font-bold text-[#5f6868]">当前范围暂无单词</div>;
  }

  return (
    <section className="relative w-full max-w-full overflow-hidden border border-[#171717]/20 bg-[#fffaf0]">
      <div className="pointer-events-none absolute right-0 top-0 h-28 w-28 border-b border-l border-[#171717]/15 bg-[#d8a92f]/25" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 border-r border-t border-[#171717]/15 bg-[#9eb8bb]/30" />

      <div className="relative grid min-w-0 gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_260px] lg:p-10">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase text-[#5f6868]">
            <span>{category?.shortLabel || "all words"}</span>
            <span>·</span>
            <span>
              {current}/{total}
            </span>
          </div>

          <Link href={`/word/${word.slug}`} className="group mt-6 inline-flex max-w-full items-end gap-2">
            <span className="truncate text-7xl font-black leading-none tracking-normal sm:text-8xl lg:text-9xl">{word.word}</span>
            <ChevronRight className="mb-3 h-6 w-6 shrink-0 text-[#5f6868] transition group-hover:translate-x-1" />
          </Link>
          <div className="mt-4 text-xl font-bold text-[#5f6868]">{word.phonetic || "phonetic pending"}</div>

          <div className="mt-10 max-w-2xl border-t border-[#171717]/15 pt-6">
            <div className="text-xs font-black uppercase text-[#5f6868]">meaning</div>
            <p className="mt-3 min-h-16 text-2xl font-black leading-9">{reveal ? word.meaningCn || "释义待补" : "先判断，再看答案"}</p>
          </div>

          <div className="mt-8 max-w-2xl border-t border-[#171717]/15 pt-6">
            <div className="text-xs font-black uppercase text-[#5f6868]">memory</div>
            <p className="mt-3 min-h-20 text-base leading-7 text-[#2d3130]">{reveal ? word.mnemonic || "还没有记忆提示，可进入单词页补充。" : "记忆提示已隐藏"}</p>
          </div>
        </div>

        <div className="min-w-0 max-w-full flex flex-col justify-end gap-3">
          <button type="button" onClick={() => onMark(word, "known")} className="h-12 border border-[#171717]/15 bg-[#e4ece2] text-sm font-black transition hover:border-[#171717]/45">
            认识
          </button>
          <button type="button" onClick={() => onMark(word, "soft")} className="h-12 border border-[#171717]/15 bg-[#f0e4c3] text-sm font-black transition hover:border-[#171717]/45">
            模糊
          </button>
          <button type="button" onClick={() => onMark(word, "unknown")} className="h-12 bg-[#171717] text-sm font-black text-[#fffaf0] transition hover:bg-[#2b2925]">
            不会
          </button>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <button type="button" onClick={onToggleReveal} className="flex h-11 items-center justify-center gap-2 border border-[#171717]/15 bg-[#fffaf0]/80 text-sm font-black transition hover:border-[#171717]/45">
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              答案
            </button>
            <button type="button" onClick={onNext} className="h-11 border border-[#171717]/15 bg-[#fffaf0]/80 text-sm font-black transition hover:border-[#171717]/45">
              下一张
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function QueuePanel({
  words,
  reviewQueue,
  activeWordId,
  onOpen
}: {
  words: HomeWord[];
  reviewQueue: HomeWord[];
  activeWordId?: string;
  onOpen: (word: HomeWord) => void;
}) {
  return (
    <section className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0">
        <div className="mb-3 text-xs font-black uppercase text-[#5f6868]">queue</div>
        <div className="flex max-w-full gap-2 overflow-x-auto pb-2">
          {words.slice(0, 12).map((word) => (
            <button
              key={word.id}
              type="button"
              onClick={() => onOpen(word)}
              className={cn(
                "min-w-[96px] border-b-2 px-1 py-3 text-left transition",
                activeWordId === word.id ? "border-[#171717]" : "border-[#171717]/10 hover:border-[#171717]/35"
              )}
            >
              <span className="block truncate text-sm font-black">{word.word}</span>
              <span className="mt-1 block truncate text-xs font-bold text-[#5f6868]">{word.meaningCn || "释义待补"}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-black uppercase text-[#5f6868]">review</span>
          <span className="text-xs font-black text-[#5f6868]">{reviewQueue.length}</span>
        </div>
        <div className="space-y-2">
          {reviewQueue.length ? (
            reviewQueue.slice(0, 4).map((word) => (
              <button
                key={word.id}
                type="button"
                onClick={() => onOpen(word)}
                className="flex w-full items-center justify-between border border-[#171717]/15 bg-[#fffaf0]/70 px-3 py-2 text-left transition hover:border-[#171717]/45"
              >
                <span className="truncate text-sm font-black">{word.word}</span>
                <ChevronRight className="h-4 w-4 text-[#5f6868]" />
              </button>
            ))
          ) : (
            <div className="border border-dashed border-[#171717]/20 px-3 py-5 text-center text-sm font-bold text-[#5f6868]">暂无复习词</div>
          )}
        </div>
      </div>
    </section>
  );
}

function MemoryModal({ word, onClose, onNext }: { word: HomeWord; onClose: () => void; onNext: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171717]/55 px-5 py-8">
      <div className="w-full max-w-xl border border-[#171717]/20 bg-[#fffaf0] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#171717]/15 p-5">
          <div>
            <div className="text-xs font-black uppercase text-[#5f6868]">memory</div>
            <h2 className="mt-1 text-5xl font-black tracking-normal">{word.word}</h2>
            <p className="mt-2 text-sm font-bold text-[#5f6868]">{word.phonetic || "phonetic pending"}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭" className="flex h-9 w-9 items-center justify-center border border-[#171717]/15">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          <div className="border-b border-[#171717]/15 pb-5">
            <div className="text-xs font-black uppercase text-[#5f6868]">meaning</div>
            <p className="mt-2 text-xl font-black leading-8">{word.meaningCn || "释义待补"}</p>
          </div>
          <div className="pt-5">
            <div className="text-xs font-black uppercase text-[#5f6868]">cue</div>
            <p className="mt-2 leading-7 text-[#2d3130]">{word.mnemonic || "还没有记忆提示，可在单词页补充。"}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#171717]/15 p-5">
          <Button asChild variant="outline" className="rounded-none">
            <Link href={`/word/${word.slug}`}>编辑</Link>
          </Button>
          <Button
            type="button"
            onClick={() => {
              onClose();
              onNext();
            }}
            className="rounded-none bg-[#171717] text-[#fffaf0] hover:bg-[#2b2925]"
          >
            <Check className="h-4 w-4" />
            下一张
          </Button>
        </div>
      </div>
    </div>
  );
}
