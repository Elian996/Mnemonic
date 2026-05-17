import Link from "next/link";
import { ArrowRight, Menu } from "lucide-react";
import { prisma } from "@/lib/db";

const wordLevelLinks = [
  { label: "二级", href: "/levels/level-2" },
  { label: "三级", href: "/levels/level-3" },
  { label: "高考3500", href: "/levels/gaokao-3500" },
  { label: "四级", href: "/levels/cet4" },
  { label: "六级", href: "/levels/cet6" }
];

export default async function HomePage() {
  const wordCount = await prisma.word.count();

  return (
    <main className="mn-home-showcase">
      <header className="mn-showcase-header">
        <Link href="/" className="mn-showcase-brand" aria-label="mnemonic 首页">
          mnemonic
        </Link>
      </header>

      <section className="mn-showcase-hero" aria-labelledby="home-cover-title">
        <div className="mn-showcase-copy">
          <h1 id="home-cover-title" className="mn-showcase-title">
            mnemonic
          </h1>
          <span className="mn-showcase-rule" aria-hidden />
          <p className="mn-showcase-tagline">用词链，记住英语单词</p>
          <p className="mn-showcase-description">
            以词链连接记忆碎片，把每个单词，
            <br />
            变成长久记得住的知识。
          </p>
          <Link
            href="/words"
            className="mn-showcase-cta group"
            aria-label={`开始记忆，进入 ${wordCount.toLocaleString("zh-CN")} 个单词`}
          >
            <span>开始记忆</span>
            <ArrowRight className="mn-showcase-cta-icon" aria-hidden />
          </Link>
        </div>

        <div className="mn-showcase-art" aria-hidden>
          <span className="mn-showcase-orbit mn-showcase-orbit-wide" />
          <span className="mn-showcase-orbit mn-showcase-orbit-tall" />
          <span className="mn-showcase-line mn-showcase-line-horizontal" />
          <span className="mn-showcase-line mn-showcase-line-vertical" />
          <span className="mn-showcase-disc mn-showcase-disc-small" />
          <span className="mn-showcase-disc mn-showcase-disc-large" />
          <span className="mn-showcase-dot mn-showcase-dot-left" />
          <span className="mn-showcase-dot mn-showcase-dot-top" />
          <span className="mn-showcase-dot mn-showcase-dot-right" />
          <span className="mn-showcase-letter">M</span>
        </div>

        <aside className="mn-showcase-scroll" aria-hidden>
          <span>SCROLL</span>
          <i />
        </aside>
      </section>

      <section className="mn-showcase-words" aria-labelledby="home-words-title">
        <header className="mn-words-nav" aria-label="单词页面导航">
          <Link href="/" className="mn-words-brand" aria-label="mnemonic 首页">
            mnemonic
          </Link>
          <Link href="/words" className="mn-words-menu" aria-label="进入单词库">
            <Menu aria-hidden />
          </Link>
        </header>

        <div className="mn-words-body">
          <div className="mn-words-copy">
            <h2 id="home-words-title" className="mn-words-title">
              单词
            </h2>
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
          {wordLevelLinks.map((item, index) => (
            <span key={item.href} className="mn-words-level-wrap">
              <Link href={item.href} className="mn-words-level">
                {item.label}
              </Link>
              {index < wordLevelLinks.length - 1 ? <span className="mn-words-connector" aria-hidden /> : null}
            </span>
          ))}
        </nav>
      </section>
    </main>
  );
}
