import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { NightCoverEyes } from "@/components/night-cover-eyes";
import { prisma } from "@/lib/db";

export default async function HomePage() {
  const wordCount = await prisma.word.count();

  return (
    <>
      <main className="mn-page mn-home-cover home-light-cover min-h-screen overflow-hidden">
        <header className="home-cover-frame home-cover-header">
          <Link href="/" className="home-cover-brand" aria-label="mnemonic 首页">
            <LogoMark className="home-cover-brand-mark" />
            <span className="home-cover-brand-text">mnemonic</span>
          </Link>
          <div aria-hidden />
        </header>

        <section className="home-cover-frame home-cover-hero">
          <div className="home-cover-left">
            <span className="home-cover-red" aria-hidden />
            <h1 className="home-cover-title">
              MNE
              <br />
              MO
              <br />
              NIC
            </h1>
            <div className="home-cover-copy">
              <p className="home-cover-copy-title">
                用词链
                <br />
                记住英语单词
              </p>
              <p className="home-cover-copy-text">
                以词链连接记忆碎片，把每个单词，变成长期记得住的知识。
              </p>
              <Link
                href="/words"
                className="home-cover-card group transition hover:-translate-y-0.5 hover:bg-black"
              >
                <span className="home-cover-card-main">
                  <span className="home-cover-card-icon">
                    <BookOpen className="home-cover-card-book" />
                  </span>
                  <span className="min-w-0">
                    <span className="home-cover-card-title">单词</span>
                    <span className="home-cover-card-count">
                      {wordCount.toLocaleString("zh-CN")} words
                    </span>
                  </span>
                </span>
                <ArrowRight className="home-cover-card-arrow transition group-hover:translate-x-1 group-hover:text-white" />
              </Link>
            </div>
          </div>

          <div className="home-cover-middle">
            <div className="home-cover-words">
              WORDS.
              <br />
              CONNECT.
              <br />
              REMEMBER.
            </div>
            <div className="home-cover-dots" aria-hidden />
          </div>

          <div className="home-cover-art">
            <div className="home-cover-art-canvas">
              <img src="/mnemonic-cover-art.png" alt="mnemonic 立体主义字母 M 插画" />
              <span className="home-cover-eye home-cover-eye-left" aria-hidden />
              <span className="home-cover-eye home-cover-eye-right" aria-hidden />
            </div>
          </div>

          <aside className="home-cover-scroll">
            <span className="home-cover-scroll-text">SCROLL</span>
            <span className="home-cover-scroll-line" aria-hidden />
          </aside>
        </section>

        <div className="home-cover-frame home-cover-bottom-blank" aria-hidden />
      </main>

      <main className="mn-night-home home-night-cover">
        <h1 hidden>mnemonic | 用词链记住英语单词</h1>
        <div className="night-cover-stage" aria-hidden>
          <NightCoverEyes />
        </div>
        <Link
          href="/words"
          className="night-cover-entry"
          aria-label={`进入单词库，当前 ${wordCount.toLocaleString("zh-CN")} 个单词`}
        >
          <BookOpen className="h-4 w-4" />
          <span>单词</span>
          <span>{wordCount.toLocaleString("zh-CN")}</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </main>
    </>
  );
}
