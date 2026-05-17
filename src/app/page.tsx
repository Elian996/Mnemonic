import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/db";

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
    </main>
  );
}
