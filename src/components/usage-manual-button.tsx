"use client";

import { useEffect, useId, useState } from "react";
import {
  BookOpen,
  Check,
  Circle,
  Keyboard,
  MousePointer2,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Volume2,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

type ManualSection = {
  title: string;
  icon: typeof BookOpen;
  items: string[];
};

const usageManualSeenStorageKey = "mnemonic_usage_manual_seen";

const mobileSections: ManualSection[] = [
  {
    title: "词库",
    icon: MousePointer2,
    items: [
      "首页选择随机、二级、三级、高考3500、四级或六级进入词库。",
      "轻点单词行打开单词卡。",
      "眼睛显示或隐藏释义；刷新重新抽取当前词库。"
    ]
  },
  {
    title: "搜索",
    icon: Search,
    items: [
      "点放大镜搜索全部单词。",
      "点搜索结果，会在当前页面打开对应单词卡。"
    ]
  },
  {
    title: "标记",
    icon: Check,
    items: [
      "对勾标为熟练，圆圈标为模糊，叉号标为生词。",
      "再点已选中的标记可取消。",
      "标记会自动保存；也可以点顶部保存按钮。"
    ]
  },
  {
    title: "单词卡",
    icon: BookOpen,
    items: [
      "左右箭头切换上一个或下一个单词。",
      "喇叭播放读音；正文里的词链可继续打开相关单词。",
      "卡片固定在屏幕内，长内容在卡片里滚动。"
    ]
  },
  {
    title: "记忆卡",
    icon: Pencil,
    items: [
      "点铅笔新建自己的记忆卡。",
      "数字标签切换卡片；双击标签置顶。",
      "长按标签修改；把标签拖出卡片外删除；撤销可恢复最近删除。"
    ]
  },
  {
    title: "我的",
    icon: Circle,
    items: [
      "熟练、模糊、生词本里也可以点词开卡。",
      "在列表或单词卡里改状态，保存后会进入对应单词本。"
    ]
  }
];

const desktopSections: ManualSection[] = [
  {
    title: "词库",
    icon: MousePointer2,
    items: [
      "从首页进入随机、二级、三级、高考3500、四级或六级。",
      "支持格子/列表视图，随机、A-Z、Z-A 排序。",
      "点击单词打开单词卡。"
    ]
  },
  {
    title: "搜索",
    icon: Search,
    items: [
      "首页搜索或顶部搜索可查全部单词。",
      "点击结果打开单词卡。",
      "⌘K / Ctrl+K 打开全站搜索，Esc 关闭。"
    ]
  },
  {
    title: "标记",
    icon: Check,
    items: [
      "对勾 / V 标为熟练，圆圈 / O 标为模糊，叉号 / X 标为生词。",
      "再次选择当前状态可取消标记。",
      "标记会自动保存；Shift+S 可手动保存。"
    ]
  },
  {
    title: "单词卡",
    icon: BookOpen,
    items: [
      "Space 打开或关闭单词卡。",
      "← / → 切换上一个或下一个单词。",
      "喇叭播放读音；正文里的词链可继续打开相关单词。"
    ]
  },
  {
    title: "记忆卡",
    icon: Pencil,
    items: [
      "铅笔新建自己的记忆卡。",
      "数字标签切换卡片；双击标签置顶。",
      "右键标签编辑；拖出弹窗删除；⌘Z / Ctrl+Z 撤销最近删除。"
    ]
  },
  {
    title: "我的",
    icon: Circle,
    items: [
      "熟练、模糊、生词本里可以继续开卡、改状态。",
      "Aa 调整单词卡字号；主题按钮切换浅色、深色或跟随系统。"
    ]
  }
];

function KeyBadge({ children }: { children: string }) {
  return (
    <kbd className="rounded bg-[#171a1f] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white dark:bg-foreground dark:text-background">
      {children}
    </kbd>
  );
}

const shortcutGroups = [
  { keys: ["Space"], label: "打开或关闭单词卡" },
  { keys: ["←", "→"], label: "切换上一个 / 下一个单词" },
  { keys: ["V"], label: "熟练" },
  { keys: ["O"], label: "模糊" },
  { keys: ["S", "X"], label: "生词 / 陌生" },
  { keys: ["Shift+S"], label: "保存单词标记" },
  { keys: ["⌘Z", "Ctrl+Z", "Shift+R"], label: "撤销标记或卡片删除" },
  { keys: ["⌘K", "Ctrl+K"], label: "全站搜索" },
  { keys: ["Esc"], label: "关闭弹窗或菜单" }
];

function ShortcutLegend() {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {shortcutGroups.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2 text-sm font-medium text-[#323741] dark:text-foreground/85"
        >
          <span className="flex shrink-0 flex-wrap items-center gap-1">
            {item.keys.map((key) => (
              <KeyBadge key={key}>{key}</KeyBadge>
            ))}
          </span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function IconLegend() {
  const items = [
    { icon: Check, label: "熟练", className: "border-[#b9e5ce] bg-[#effaf3] text-[#168458]" },
    { icon: Circle, label: "模糊", className: "border-[#ead38a] bg-[#fff8df] text-[#9a6a00]" },
    { icon: X, label: "陌生", className: "border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d]" },
    {
      icon: Search,
      label: "搜索单词",
      className:
        "border-[#d8dde6] bg-white text-[#69717f] dark:border-border dark:bg-card dark:text-muted-foreground"
    },
    {
      icon: Volume2,
      label: "播放读音",
      className:
        "border-[#d8dde6] bg-white text-[#69717f] dark:border-border dark:bg-card dark:text-muted-foreground"
    },
    {
      icon: Save,
      label: "保存标记",
      className:
        "border-[#d8dde6] bg-white text-[#171a1f] dark:border-border dark:bg-card dark:text-foreground"
    },
    {
      icon: Pencil,
      label: "新建/编辑记忆卡",
      className:
        "border-[#d8dde6] bg-white text-[#171a1f] dark:border-border dark:bg-card dark:text-foreground"
    },
    {
      icon: RotateCcw,
      label: "撤销最近一步",
      className:
        "border-[#d8dde6] bg-white text-[#69717f] dark:border-border dark:bg-card dark:text-muted-foreground"
    },
    {
      icon: Trash2,
      label: "拖出删除卡",
      className:
        "border-[#d8dde6] bg-white text-[#c2412d] dark:border-border dark:bg-card dark:text-red-300"
    }
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-2 text-sm font-medium text-[#323741] dark:text-foreground/85"
          >
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                item.className
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            {item.label}
          </div>
        );
      })}
    </div>
  );
}

export function UsageManualButton({
  className,
  autoOpen = false
}: {
  className?: string;
  autoOpen?: boolean;
} = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [manualMode, setManualMode] = useState<"mobile" | "desktop">("desktop");
  const [shouldMarkSeenOnClose, setShouldMarkSeenOnClose] = useState(false);
  const titleId = useId();
  const isMobileManual = manualMode === "mobile";
  const sections = isMobileManual ? mobileSections : desktopSections;
  const manualTitle = isMobileManual ? "手机端功能说明" : "电脑端功能说明";

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateMode = () => setManualMode(mediaQuery.matches ? "mobile" : "desktop");
    updateMode();
    mediaQuery.addEventListener("change", updateMode);
    return () => mediaQuery.removeEventListener("change", updateMode);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("mn-usage-manual-open", isOpen);
    return () => document.documentElement.classList.remove("mn-usage-manual-open");
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeManual();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, shouldMarkSeenOnClose]);

  useEffect(() => {
    if (!autoOpen) return;
    if (hasSeenUsageManual()) return;

    openManual({ markSeenOnClose: true });
  }, [autoOpen]);

  const closeManual = () => {
    if (shouldMarkSeenOnClose) {
      markUsageManualSeen();
      setShouldMarkSeenOnClose(false);
    }
    setIsOpen(false);
  };

  const openManual = ({ markSeenOnClose = false }: { markSeenOnClose?: boolean } = {}) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    window.dispatchEvent(new CustomEvent("mnemonic:usage-manual-open"));
    setShouldMarkSeenOnClose(markSeenOnClose);
    setIsOpen(true);
  };

  return (
    <>
      <button
        type="button"
        aria-label="打开使用说明"
        title="使用说明"
        onClick={() => openManual()}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md border border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] transition hover:border-[#c2412d] hover:bg-[#ffe5df] dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
          className
        )}
      >
        <BookOpen className="h-4 w-4" />
      </button>

      {isOpen ? (
        <div
          className="mn-usage-manual-backdrop fixed inset-0 z-[160] bg-[#171a1f]/25 p-4 backdrop-blur-[2px] dark:bg-black/55"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="mn-usage-manual-dialog mx-auto flex max-h-[calc(100vh-2rem)] w-[min(920px,100%)] flex-col overflow-hidden rounded-xl border border-[#d8dde6] bg-white text-[#171a1f] shadow-[0_24px_80px_rgba(23,26,31,0.22)] dark:border-border dark:bg-card dark:text-foreground"
          >
            <header className="mn-usage-manual-header flex shrink-0 items-start justify-between gap-4 border-b border-[#eef2f6] p-5 dark:border-border">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#c2412d] dark:text-red-300">
                  <BookOpen className="h-4 w-4" />
                  使用说明
                </div>
                <h2 id={titleId} className="mt-2 text-2xl font-semibold tracking-normal">
                  {manualTitle}
                </h2>
              </div>
              <button
                type="button"
                aria-label="关闭使用手册"
                title="关闭"
                onClick={closeManual}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto p-5">
              <div className="grid gap-4 lg:grid-cols-2">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <section
                      key={section.title}
                      className="mn-usage-manual-section rounded-lg border border-[#d8dde6] p-4 dark:border-border"
                    >
                      <h3 className="flex items-center gap-2 text-base font-semibold">
                        <Icon className="h-4 w-4 text-[#c2412d] dark:text-red-300" />
                        {section.title}
                      </h3>
                      <ul className="mt-3 space-y-2 text-sm leading-6 text-[#323741] dark:text-foreground/85">
                        {section.items.map((item) => (
                          <li key={item} className="flex gap-2">
                            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#c2412d] dark:bg-red-300" />
                            <span>{renderShortcutText(item)}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                <section className="mn-usage-manual-section rounded-lg border border-[#d8dde6] p-4 dark:border-border">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[#69717f] dark:text-muted-foreground">
                    <Search className="h-4 w-4" />
                    图标速查
                  </h3>
                  <div className="mt-3">
                    <IconLegend />
                  </div>
                </section>

                {!isMobileManual ? (
                  <section className="mn-usage-manual-section rounded-lg border border-[#d8dde6] p-4 dark:border-border">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-[#69717f] dark:text-muted-foreground">
                      <Keyboard className="h-4 w-4" />
                      电脑快捷键
                    </h3>
                    <div className="mt-3">
                      <ShortcutLegend />
                    </div>
                  </section>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function hasSeenUsageManual() {
  try {
    return window.localStorage.getItem(usageManualSeenStorageKey) === "1";
  } catch {
    return true;
  }
}

function markUsageManualSeen() {
  try {
    window.localStorage.setItem(usageManualSeenStorageKey, "1");
  } catch {
    // Ignore storage failures; the manual button remains available.
  }
}

function renderShortcutText(text: string) {
  const parts = text.split(
    /(Shift\+R|Shift\+S|⌘K|Ctrl\+K|⌘Z|Cmd\+Z|Ctrl\+Z|Enter|Space|Esc|A-Z|Z-A|←|→|\bV\b|\bO\b|\bS\b|\bX\b)/g
  );
  return parts.map((part, index) => {
    if (!part) return null;
    if (
      /^(Shift\+R|Shift\+S|⌘K|Ctrl\+K|⌘Z|Cmd\+Z|Ctrl\+Z|Enter|Space|Esc|A-Z|Z-A|←|→|V|O|S|X)$/u.test(
        part
      )
    ) {
      return <KeyBadge key={`${part}-${index}`}>{part}</KeyBadge>;
    }
    return part;
  });
}
