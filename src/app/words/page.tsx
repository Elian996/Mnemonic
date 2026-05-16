import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { UserRole } from "@prisma/client";
import { HiddenRepositoryGate } from "@/components/hidden-repository-gate";
import { PublicTopBar } from "@/components/public-top-bar";
import { WordMemorySearch } from "@/components/word-memory-search";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { vocabCategories } from "@/lib/vocab-categories";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export default async function WordsPage() {
  const [user, totalCount, counts] = await Promise.all([
    getSessionUser(),
    prisma.word.count(),
    Promise.all(
      vocabCategories.map(async (category) => ({
        tag: category.tag,
        count: await prisma.word.count({ where: { levelTags: { has: category.tag } } })
      }))
    )
  ]);
  const countByTag = Object.fromEntries(counts.map((item) => [item.tag, item.count]));
  const canEditOfficial = hasRole(user, UserRole.EDITOR);

  return (
    <InteriorPage>
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "单词" }
        ]}
        rightSlot={<WordMemorySearch isAuthenticated={Boolean(user)} canEditOfficialCards={canEditOfficial} />}
      />

      <InteriorContainer>
        <InteriorHero
          eyebrow="words"
          title={<HiddenRepositoryGate>单词</HiddenRepositoryGate>}
          description={`按词汇阶段进入对应页面。当前词库共 ${totalCount.toLocaleString("zh-CN")} 个单词。`}
          meta="选择阶段，开始一组单词"
        >
          <BookOpen className="h-16 w-16 text-[var(--mn-red)]" />
        </InteriorHero>

        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vocabCategories.map((category) => (
            <Link
              key={category.tag}
              href={category.href}
              className="mn-link-card group flex min-h-44 flex-col justify-between p-5"
            >
              <span>
                <span className="block font-serif text-3xl font-semibold tracking-normal">{category.label}</span>
                <span className="mt-3 block text-sm leading-6 text-[var(--mn-muted)]">{category.description}</span>
              </span>
              <span className="mt-6 flex items-center justify-between text-sm font-semibold">
                <span className="text-[var(--mn-red)]">{(countByTag[category.tag] ?? 0).toLocaleString("zh-CN")} 词</span>
                <ChevronRight className="h-4 w-4 text-[var(--mn-muted)] transition group-hover:translate-x-0.5 group-hover:text-[var(--mn-ink)]" />
              </span>
            </Link>
          ))}
        </div>
      </InteriorContainer>
    </InteriorPage>
  );
}
