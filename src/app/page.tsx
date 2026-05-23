import Link from "next/link";
import { HomeWordSearch } from "@/components/home/HomeWordSearch";
import { ThemeToggle } from "@/components/theme-toggle";
import { vocabCategories } from "@/lib/vocab-categories";

const categoryOrder = ["LEVEL_2", "LEVEL_3", "GAOKAO_3500", "CET4", "CET6"] as const;
const randomCategory = {
  tag: "RANDOM",
  href: "/levels/random",
  shortLabel: "随机"
};

const mobileHomeCriticalCss = `
@media (max-width: 768px) {
  :root {
    --mn-bg: #f7f3ec;
    --mn-surface: #fbf8f2;
    --mn-text: #111820;
    --mn-text-muted: rgba(17, 24, 32, 0.56);
    --mn-text-faint: rgba(17, 24, 32, 0.36);
    --mn-border: rgba(17, 24, 32, 0.12);
    --mn-border-soft: rgba(17, 24, 32, 0.08);
    --mn-accent: #8a3a2b;
    --mn-shadow-soft: 0 18px 48px rgba(30, 24, 18, 0.06);
    --mn-serif: Georgia, "Times New Roman", "Noto Serif SC", "Songti SC", serif;
    --mn-sans: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "PingFang SC", "Noto Sans SC", Arial, sans-serif;
  }

  html,
  body {
    margin: 0;
    background: var(--mn-bg);
    color: var(--mn-text);
    font-family: var(--mn-sans);
  }

  .mn-home-page {
    min-height: 100vh;
    background:
      radial-gradient(circle at 50% 8%, rgba(255, 255, 255, 0.82), transparent 42%),
      var(--mn-bg);
    color: var(--mn-text);
    padding: 0 30px calc(34px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    overflow-x: hidden;
  }

  .mn-home-inner {
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
  }

  .mn-topbar {
    height: 86px;
    padding-top: max(16px, env(safe-area-inset-top));
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--mn-border-soft);
    box-sizing: border-box;
  }

  .mn-topbar-brand {
    font-family: var(--mn-serif);
    font-size: 30px;
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--mn-text);
    text-decoration: none;
  }

  .mn-topbar-actions {
    display: flex;
    align-items: center;
    gap: 0;
  }

  .mn-home-theme-toggle {
    display: none !important;
  }

  .mn-topbar-nav {
    display: flex;
    align-items: center;
    gap: 34px;
  }

  .mn-topbar-link {
    position: relative;
    font-size: 19px;
    line-height: 1;
    color: var(--mn-text-muted);
    text-decoration: none;
    font-weight: 400;
  }

  .mn-topbar-link.is-active {
    color: var(--mn-text);
  }

  .mn-topbar-link.is-active::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -20px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--mn-accent);
    transform: translateX(-50%);
  }

  .mn-hero {
    text-align: center;
    padding-top: 86px;
  }

  .mn-hero-title {
    font-family: var(--mn-serif);
    font-size: clamp(58px, 17vw, 76px);
    line-height: 0.95;
    font-weight: 400;
    letter-spacing: -0.065em;
    margin: 0;
    color: var(--mn-text);
  }

  .mn-hero-subtitle {
    margin: 26px 0 0;
    font-size: 22px;
    line-height: 1.4;
    letter-spacing: 0.18em;
    color: var(--mn-text-muted);
    font-weight: 400;
  }

  .mn-home-search-wrap {
    position: relative;
    z-index: 30;
    width: 100%;
    margin: 50px auto 0;
  }

  .mn-search {
    width: 100%;
    height: 72px;
    margin: 0;
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 0 28px;
    border: 1px solid var(--mn-border);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.32);
    box-shadow: 0 12px 30px rgba(30, 24, 18, 0.045);
    box-sizing: border-box;
  }

  .mn-search:focus-within {
    border-color: rgba(17, 24, 32, 0.22);
    background: rgba(255, 255, 255, 0.42);
  }

  .mn-search-icon,
  .mn-search-icon svg {
    width: 28px;
    height: 28px;
  }

  .mn-search-icon {
    color: var(--mn-text-faint);
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .mn-search input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-size: 22px;
    color: var(--mn-text);
    font-family: var(--mn-sans);
  }

  .mn-search input::placeholder {
    color: var(--mn-text-faint);
  }

  .mn-category-row {
    margin-top: 34px;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
    gap: 14px;
    overflow: visible;
    padding: 0 0 4px;
  }

  .mn-category-button {
    width: 100%;
    height: 56px;
    min-width: 0;
    padding: 0 12px;
    border: 1px solid var(--mn-border-soft);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.2);
    color: rgba(58, 45, 33, 0.86);
    font-size: 19px;
    font-family: var(--mn-sans);
    font-weight: 400;
    white-space: nowrap;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-decoration: none;
    box-sizing: border-box;
  }

  .mn-category-button:active,
  .mn-preview-button:active {
    transform: scale(0.98);
  }

  .mn-preview-card {
    width: 100%;
    margin: 46px auto 0;
    display: grid;
    grid-template-columns: 1fr;
    border: 1px solid var(--mn-border);
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.22);
    box-shadow: var(--mn-shadow-soft);
    overflow: hidden;
    text-align: left;
  }

  .mn-preview-word {
    padding: 52px 36px 42px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .mn-preview-word-title {
    font-family: var(--mn-serif);
    font-size: 56px;
    line-height: 1;
    font-weight: 400;
    letter-spacing: -0.045em;
    margin: 0;
    color: var(--mn-text);
  }

  .mn-preview-meaning {
    margin: 18px 0 0;
    font-size: 24px;
    color: var(--mn-accent);
    line-height: 1.2;
  }

  .mn-preview-pronunciation {
    margin: 22px 0 0;
    font-size: 20px;
    color: var(--mn-text-muted);
  }

  .mn-preview-definition {
    margin: 24px 0 0;
    max-width: 310px;
    font-size: 20px;
    line-height: 1.58;
    color: var(--mn-text-muted);
  }

  .mn-preview-button {
    margin-top: 36px;
    width: fit-content;
    height: 48px;
    padding: 0 26px;
    border: 1px solid rgba(138, 58, 43, 0.42);
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.22);
    color: var(--mn-accent);
    font-size: 18px;
    font-family: var(--mn-sans);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 14px;
    justify-content: center;
  }

  .mn-preview-graph {
    position: relative;
    min-height: 350px;
    border-top: 1px solid var(--mn-border-soft);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 22px 0 30px;
    box-sizing: border-box;
  }

  .mn-mini-word-graph {
    width: min(360px, 100%);
    height: auto;
    display: block;
    overflow: visible;
  }

  .mn-mini-graph-ring {
    fill: none;
    stroke: rgba(17, 24, 32, 0.08);
    stroke-width: 1;
    stroke-dasharray: 3 7;
  }

  .mn-mini-graph-ring-outer {
    opacity: 0.58;
  }

  .mn-mini-graph-ring-inner {
    opacity: 0.72;
  }

  .mn-mini-graph-link {
    stroke: rgba(17, 24, 32, 0.16);
    stroke-width: 1;
  }

  .mn-mini-graph-center {
    fill: rgba(255, 255, 255, 0.3);
    stroke: rgba(17, 24, 32, 0.12);
    stroke-width: 1;
    filter: drop-shadow(0 10px 22px rgba(30, 24, 18, 0.06));
  }

  .mn-mini-graph-center-text {
    fill: var(--mn-text);
    font-family: var(--mn-serif);
    font-size: 24px;
    font-weight: 400;
  }

  .mn-mini-graph-node rect {
    fill: rgba(255, 255, 255, 0.28);
    stroke: rgba(17, 24, 32, 0.12);
    stroke-width: 1;
  }

  .mn-mini-graph-node text {
    fill: rgba(17, 24, 32, 0.76);
    font-family: var(--mn-sans);
    font-size: 16px;
  }

  .mn-scroll-cue {
    margin: 28px auto 0;
    width: 26px;
    height: 26px;
    color: var(--mn-accent);
    opacity: 0.9;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .mn-scroll-cue span {
    width: 12px;
    height: 12px;
    margin: 0;
    border-right: 1.6px solid currentColor;
    border-bottom: 1.6px solid currentColor;
    transform: rotate(45deg);
  }
}

@media (max-width: 360px) {
  .mn-category-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
`;

export default async function HomePage() {
  const categories = [
    randomCategory,
    ...categoryOrder
      .map((tag) => vocabCategories.find((category) => category.tag === tag))
      .filter((category): category is (typeof vocabCategories)[number] => Boolean(category))
  ];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: mobileHomeCriticalCss }} />
      <main className="mn-home-page">
        <div className="mn-home-inner">
          <header className="mn-topbar">
            <Link href="/" className="mn-topbar-brand" aria-label="mnemonic 首页">
              mnemonic
            </Link>
            <div className="mn-topbar-actions">
              <nav className="mn-topbar-nav" aria-label="首页导航">
                <Link href="/" className="mn-topbar-link is-active">
                  首页
                </Link>
                <Link href="/me" className="mn-topbar-link">
                  我的
                </Link>
              </nav>
              <ThemeToggle variant="segmented" className="mn-home-theme-toggle" />
            </div>
          </header>

          <section className="mn-hero" aria-labelledby="home-hero-title">
            <h1 id="home-hero-title" className="mn-hero-title">
              mnemonic
            </h1>
            <p className="mn-hero-subtitle">用联想，记住英语单词</p>

            <HomeWordSearch categories={categories} />

            <div className="mn-scroll-cue" aria-hidden="true">
              <span />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
