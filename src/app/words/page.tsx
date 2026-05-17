import Link from "next/link";
import { UserRole } from "@prisma/client";
import { PublicTopBar } from "@/components/public-top-bar";
import { WordMemorySearch } from "@/components/word-memory-search";
import { getSessionUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { hasRole } from "@/lib/permissions";
import { vocabCategories } from "@/lib/vocab-categories";
import { InteriorPage } from "@/components/interior-shell";

const wordPageLevelOrder = ["LEVEL_2", "LEVEL_3", "GAOKAO_3500", "CET4", "CET6"];

export default async function WordsPage() {
  const [user, counts] = await Promise.all([
    getSessionUser(),
    Promise.all(
      vocabCategories.map(async (category) => ({
        tag: category.tag,
        count: await prisma.word.count({ where: { levelTags: { has: category.tag } } })
      }))
    )
  ]);
  const countByTag = Object.fromEntries(counts.map((item) => [item.tag, item.count]));
  const orderedCategories = wordPageLevelOrder
    .map((tag) => vocabCategories.find((category) => category.tag === tag))
    .filter((category): category is (typeof vocabCategories)[number] => Boolean(category));
  const canEditOfficial = hasRole(user, UserRole.EDITOR);

  return (
    <InteriorPage className="mn-words-page">
      <PublicTopBar
        user={user}
        breadcrumbs={[
          { label: "首页", href: "/" },
          { label: "单词" }
        ]}
        rightSlot={<WordMemorySearch isAuthenticated={Boolean(user)} canEditOfficialCards={canEditOfficial} />}
      />

      <section className="mn-showcase-words" aria-labelledby="words-page-title">
        <div className="mn-words-body">
          <div className="mn-words-copy">
            <h1 id="words-page-title" className="mn-words-title">
              单词
            </h1>
            <span className="mn-words-rule" aria-hidden />
            <p className="mn-words-tagline">用词链，记住英语单词</p>
            <p className="mn-words-description">
              以词链连接记忆碎片，把每个单词，
              <br />
              变成长久记得住的知识。
            </p>
          </div>

          <div className="mn-words-watermark" aria-hidden>
            M
          </div>
        </div>

        <nav className="mn-words-levels" aria-label="按词表开始记忆">
          {orderedCategories.map((category, index) => (
            <span key={category.tag} className="mn-words-level-wrap">
              <Link
                href={category.href}
                className="mn-words-level"
                aria-label={`${category.label}，${(countByTag[category.tag] ?? 0).toLocaleString("zh-CN")} 词`}
              >
                {category.shortLabel}
              </Link>
              {index < orderedCategories.length - 1 ? <span className="mn-words-connector" aria-hidden /> : null}
            </span>
          ))}
        </nav>
      </section>
    </InteriorPage>
  );
}
