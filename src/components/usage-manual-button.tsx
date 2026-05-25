"use client";

import { useEffect, useId, useState } from "react";
import {
  BookOpen,
  Check,
  Circle,
  Keyboard,
  MousePointer2,
  Palette,
  Pencil,
  Save,
  Search,
  Star,
  Type,
  Volume2,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  {
    title: "单词浏览",
    icon: MousePointer2,
    items: [
      "单击单词小卡片或列表行，打开这个单词的记忆卡弹窗；键盘聚焦到单词后，Enter / Space 也可以打开。",
      "在阶段词库页，Space 会打开当前选中的单词；有记忆卡打开时，Space 会关闭当前记忆卡。",
      "显示释义会露出小卡片释义，再点一次隐藏；格子和列表按钮切换视图。",
      "随机会重新洗牌当前阶段，A-Z / Z-A 会按字母排序。"
    ]
  },
  {
    title: "标记单词",
    icon: Check,
    items: [
      "绿色对勾 / V 标为熟练；在记忆卡里按 V 会标记并自动切到下一个单词。",
      "黄色圆圈 / O 标为模糊。",
      "红色叉号 / S / X 标为生词或陌生；S 取“生词”的拼音首字母，X 对应叉号。",
      "再点已经选中的标记会取消；熟练单词会从当前学习列表移出。",
      "Shift+S 手动保存未保存的单词标记；离开页面或稍等片刻也会自动保存。"
    ]
  },
  {
    title: "记忆卡弹窗",
    icon: BookOpen,
    items: [
      "拖动弹窗标题栏可以移动记忆卡，右上角 X、Esc 或阶段词库页的 Space 关闭当前卡。",
      "← / → 在当前列表里循环切换上一个或下一个单词。",
      "喇叭播放读音；记忆卡正文里的单词链接可直接打开对应单词。",
      "星标可把当前词加入模糊或生词，再点已选星标可取消。"
    ]
  },
  {
    title: "多张记忆卡与编辑",
    icon: Pencil,
    items: [
      "弹窗右上角的小数字是记忆卡标签：单击切换当前卡。",
      "双击小数字会把这张卡前置为默认卡。",
      "右键小数字进入编辑；拖出弹窗范围会删除该卡。",
      "删除后可点撤销按钮，或按 ⌘Z / Ctrl+Z / Shift+R 撤销。",
      "铅笔会新建自己的记忆卡；保存用对勾，退出编辑用红色 X，草稿会自动保留。",
      "有图片权限时，编辑区的图片按钮可插入图片；有导出权限时，可导出完整单词卡图片。"
    ]
  },
  {
    title: "搜索、主题与字号",
    icon: Palette,
    items: [
      "⌘K / Ctrl+K 打开全站搜索，输入后按 Enter 跳转搜索结果页。",
      "阶段词库页顶部的放大镜可搜索全部单词；搜索框里按 Enter 发起搜索，Esc 关闭搜索结果或菜单。",
      "主题按钮有三档：跟随系统、浅色、深色；默认跟随系统。",
      "Aa 按钮调节单词卡、弹窗正文和列表里的字号。",
      "Shift++ / Shift+- 调节单词卡字号。",
      "系统深浅色变化时，跟随系统模式会自动切换网站颜色。"
    ]
  },
  {
    title: "保存、撤销与权限",
    icon: Save,
    items: [
      "⌘Z / Ctrl+Z 或 Shift+R 撤销上一次单词标记，也会优先撤销当前记忆卡里最近删除的卡片。",
      "输入框、搜索框、编辑器里不会触发这些单词快捷键，可以正常打字。",
      "普通账号可以新建并编辑自己创建的记忆卡。",
      "官方已有记忆卡只允许编辑员修改；普通账号右键官方卡会看到提醒。",
      "需要改官方内容时，可以先新建自己的版本，再按个人流程管理。"
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
  { keys: ["V"], label: "熟练，记忆卡内会自动前进" },
  { keys: ["O"], label: "模糊" },
  { keys: ["S", "X"], label: "生词 / 陌生" },
  { keys: ["Shift+S"], label: "保存单词标记" },
  { keys: ["⌘Z", "Ctrl+Z", "Shift+R"], label: "撤销标记或卡片删除" },
  { keys: ["⌘K", "Ctrl+K"], label: "全站搜索" },
  { keys: ["Shift++", "Shift+-"], label: "调整字号" },
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
      icon: Star,
      label: "加入生词/模糊",
      className: "border-[#e7c766] bg-[#fff8df] text-[#d89a00]"
    },
    {
      icon: Volume2,
      label: "播放读音",
      className:
        "border-[#d8dde6] bg-white text-[#69717f] dark:border-border dark:bg-card dark:text-muted-foreground"
    },
    {
      icon: Type,
      label: "字号",
      className:
        "border-[#d8dde6] bg-white text-[#171a1f] dark:border-border dark:bg-card dark:text-foreground"
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

export function UsageManualButton({ className }: { className?: string } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <>
      <button
        type="button"
        aria-label="打开快捷操作使用手册"
        title="快捷操作使用手册"
        onClick={() => setIsOpen(true)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-md border border-[#f1b8ad] bg-[#fff1ee] text-[#c2412d] transition hover:border-[#c2412d] hover:bg-[#ffe5df] dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300",
          className
        )}
      >
        <BookOpen className="h-4 w-4" />
      </button>

      {isOpen ? (
        <div
          className="fixed inset-0 z-[90] bg-[#171a1f]/25 p-4 backdrop-blur-[2px] dark:bg-black/55"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="mx-auto flex max-h-[calc(100vh-2rem)] w-[min(920px,100%)] flex-col overflow-hidden rounded-xl border border-[#d8dde6] bg-white text-[#171a1f] shadow-[0_24px_80px_rgba(23,26,31,0.22)] dark:border-border dark:bg-card dark:text-foreground"
          >
            <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#eef2f6] p-5 dark:border-border">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[#c2412d] dark:text-red-300">
                  <BookOpen className="h-4 w-4" />
                  使用手册
                </div>
                <h2 id={titleId} className="mt-2 text-2xl font-semibold tracking-normal">
                  单词页快捷操作
                </h2>
              </div>
              <button
                type="button"
                aria-label="关闭使用手册"
                title="关闭"
                onClick={() => setIsOpen(false)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-[#d8dde6] text-[#69717f] transition hover:border-[#171a1f] hover:text-[#171a1f] dark:border-border dark:text-muted-foreground dark:hover:border-foreground dark:hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
                <section className="rounded-lg border border-[#d8dde6] p-4 dark:border-border">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[#69717f] dark:text-muted-foreground">
                    <Keyboard className="h-4 w-4" />
                    快捷键速查
                  </h3>
                  <div className="mt-3">
                    <ShortcutLegend />
                  </div>
                </section>

                <section className="rounded-lg border border-[#d8dde6] p-4 dark:border-border">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-[#69717f] dark:text-muted-foreground">
                    <Search className="h-4 w-4" />
                    图标速查
                  </h3>
                  <div className="mt-3">
                    <IconLegend />
                  </div>
                </section>
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <section
                      key={section.title}
                      className="rounded-lg border border-[#d8dde6] p-4 dark:border-border"
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
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function renderShortcutText(text: string) {
  const parts = text.split(
    /(Shift\+R|Shift\+S|Shift\+\+|Shift\+-|⌘K|Ctrl\+K|⌘Z|Cmd\+Z|Ctrl\+Z|Enter|Space|Esc|A-Z|Z-A|Aa|←|→|\bV\b|\bO\b|\bS\b|\bX\b)/g
  );
  return parts.map((part, index) => {
    if (!part) return null;
    if (
      /^(Shift\+R|Shift\+S|Shift\+\+|Shift\+-|⌘K|Ctrl\+K|⌘Z|Cmd\+Z|Ctrl\+Z|Enter|Space|Esc|A-Z|Z-A|Aa|←|→|V|O|S|X)$/u.test(
        part
      )
    ) {
      return <KeyBadge key={`${part}-${index}`}>{part}</KeyBadge>;
    }
    return part;
  });
}
