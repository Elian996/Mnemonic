import { HomeWordSearch } from "@/components/home/HomeWordSearch";
import { PublicTopBar } from "@/components/public-top-bar";
import { getSessionUser } from "@/lib/auth/session";
import { vocabCategories } from "@/lib/vocab-categories";

const categoryOrder = ["LEVEL_2", "LEVEL_3", "GAOKAO_3500", "CET4", "CET6"] as const;
const randomCategory = {
  tag: "RANDOM",
  href: "/levels/random",
  shortLabel: "随机"
};

// Apple-style mobile home — frosted nav, ultralight hero, iOS search bar,
// 3x2 category grid, Apple News-style preview card.
// Keeps every existing class name so the HomeWordSearch/ThemeToggle markup is unchanged.
const mobileHomeCriticalCss = `
@media (max-width: 768px) {
  .mn-home-page {
    --mn-bg: #FAFAF9;
    --mn-surface: #FFFFFF;
    --mn-surface-soft: #F2F2F7;
    --mn-text: #1D1D1F;
    --mn-text-muted: rgba(29,29,31,0.6);
    --mn-text-faint: rgba(29,29,31,0.42);
    --mn-text-quaternary: rgba(29,29,31,0.25);
    --mn-border: rgba(60,60,67,0.10);
    --mn-border-soft: rgba(60,60,67,0.06);
    --mn-accent: #007AFF;
    --mn-serif: 'Playfair Display', 'New York', Georgia, serif;
    --mn-sans: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Inter', 'PingFang SC', 'Helvetica Neue', sans-serif;
    min-height: 100vh;
    background: var(--mn-bg);
    color: var(--mn-text);
    font-family: var(--mn-sans);
    padding: 0 0 calc(34px + env(safe-area-inset-bottom));
    box-sizing: border-box;
    overflow-x: hidden;
    color-scheme: light;
    letter-spacing: -0.01em;
  }

  html.dark .mn-home-page,
  html[data-theme="dark"] .mn-home-page {
    --mn-bg: #000000;
    --mn-surface: #1C1C1E;
    --mn-surface-soft: #2C2C2E;
    --mn-text: #FFFFFF;
    --mn-text-muted: rgba(255,255,255,0.6);
    --mn-text-faint: rgba(255,255,255,0.42);
    --mn-text-quaternary: rgba(255,255,255,0.25);
    --mn-border: rgba(255,255,255,0.10);
    --mn-border-soft: rgba(255,255,255,0.06);
    color-scheme: dark;
  }

  .mn-home-inner {
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
  }

  /* iOS frosted nav — use double-class for specificity */
  .mn-home-page .mn-topbar {
    position: sticky !important;
    top: 0 !important;
    z-index: 30 !important;
    height: auto !important;
    min-height: 0 !important;
    padding: 14px 20px !important;
    padding-top: max(14px, calc(env(safe-area-inset-top) + 4px)) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    backdrop-filter: blur(20px) saturate(180%) !important;
    -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
    background: rgba(250,250,249,0.72) !important;
    border-bottom: 0.5px solid var(--mn-border-soft) !important;
    box-sizing: border-box;
  }

  html.dark .mn-home-page .mn-topbar,
  html[data-theme="dark"] .mn-home-page .mn-topbar {
    background: rgba(0,0,0,0.72) !important;
  }

  .mn-home-page .mn-topbar-brand {
    font-family: var(--mn-sans) !important;
    font-size: 17px !important;
    font-weight: 500 !important;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--mn-text);
    text-decoration: none;
  }

  .mn-home-page .mn-topbar-actions {
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
  }

  .mn-home-page .mn-home-theme-toggle-desktop {
    display: none !important;
  }

  .mn-home-page .mn-home-theme-toggle-mobile {
    display: inline-flex !important;
  }

  .mn-home-page .mn-home-theme-button {
    width: 32px !important;
    height: 32px !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 50% !important;
    background: rgba(0,0,0,0.05) !important;
    color: var(--mn-text-muted);
    box-shadow: none;
    margin-left: 6px;
  }

  .mn-home-page .mn-home-theme-button:hover {
    background: rgba(0,0,0,0.08) !important;
  }

  html.dark .mn-home-page .mn-home-theme-button,
  html[data-theme="dark"] .mn-home-page .mn-home-theme-button {
    background: rgba(255,255,255,0.10) !important;
  }

  html.dark .mn-home-page .mn-home-theme-button:hover,
  html[data-theme="dark"] .mn-home-page .mn-home-theme-button:hover {
    background: rgba(255,255,255,0.15) !important;
  }

  .mn-home-page .mn-home-theme-button svg {
    width: 16px !important;
    height: 16px !important;
    stroke-width: 1.8;
  }

  .mn-home-page .mn-topbar-nav {
    display: flex !important;
    align-items: center !important;
    gap: 2px !important;
  }

  .mn-home-page .mn-topbar-link {
    position: relative;
    padding: 6px 12px !important;
    font-size: 15px !important;
    font-weight: 400 !important;
    line-height: 1;
    color: var(--mn-text-muted) !important;
    text-decoration: none;
    letter-spacing: -0.01em;
  }

  .mn-home-page .mn-topbar-link.is-active {
    color: var(--mn-text) !important;
    font-weight: 500 !important;
  }

  .mn-home-page .mn-topbar-link.is-active::after {
    display: none !important;
  }

  /* Hero — Inter ultralight 200, paired with PingFang SC */
  .mn-home-page .mn-hero {
    text-align: left !important;
    padding: 56px 28px 0 !important;
  }

  .mn-home-page .mn-hero-title {
    font-family: var(--mn-sans) !important;
    font-size: clamp(48px, 14vw, 60px) !important;
    line-height: 1 !important;
    font-weight: 200 !important;
    letter-spacing: -0.04em !important;
    margin: 0 0 16px !important;
    color: var(--mn-text) !important;
  }

  .mn-home-page .mn-hero-subtitle {
    margin: 0 !important;
    font-size: 17px !important;
    line-height: 1.5 !important;
    letter-spacing: 0.01em !important;
    color: var(--mn-text-faint) !important;
    font-weight: 300 !important;
  }

  /* iOS search bar (gray pill) */
  .mn-home-page .mn-home-search-wrap {
    position: relative !important;
    z-index: 30 !important;
    width: auto !important;
    margin: 36px 28px 0 !important;
  }

  .mn-home-page .mn-search {
    width: 100% !important;
    height: 44px !important;
    margin: 0 !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 0 12px !important;
    border: 0 !important;
    border-radius: 12px !important;
    background: rgba(120,120,128,0.10) !important;
    box-shadow: none !important;
    box-sizing: border-box;
  }

  .mn-home-page .mn-search:focus-within {
    background: rgba(120,120,128,0.16) !important;
  }

  html.dark .mn-home-page .mn-search,
  html[data-theme="dark"] .mn-home-page .mn-search {
    background: rgba(118,118,128,0.24) !important;
  }

  html.dark .mn-home-page .mn-search:focus-within,
  html[data-theme="dark"] .mn-home-page .mn-search:focus-within {
    background: rgba(118,118,128,0.36) !important;
  }

  .mn-home-page .mn-search-icon,
  .mn-home-page .mn-search-icon svg {
    width: 17px !important;
    height: 17px !important;
  }

  .mn-home-page .mn-search-icon {
    color: var(--mn-text-faint) !important;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .mn-home-page .mn-search input {
    -webkit-appearance: none;
    appearance: none;
    flex: 1;
    min-width: 0;
    border: 0;
    border-radius: 0;
    outline: none;
    background: transparent !important;
    box-shadow: none;
    font-size: 17px !important;
    color: var(--mn-text) !important;
    -webkit-text-fill-color: var(--mn-text) !important;
    font-family: var(--mn-sans);
    caret-color: var(--mn-accent);
    color-scheme: inherit;
    letter-spacing: -0.02em;
  }

  .mn-search input::placeholder {
    color: var(--mn-text-faint) !important;
    opacity: 1;
    -webkit-text-fill-color: var(--mn-text-faint) !important;
  }

  .mn-home-page .mn-search input {
    background: transparent !important;
    color: var(--mn-text) !important;
    -webkit-text-fill-color: var(--mn-text) !important;
  }

  .mn-home-page .mn-search input::placeholder {
    color: var(--mn-text-faint) !important;
    -webkit-text-fill-color: var(--mn-text-faint) !important;
  }

  .mn-search input::-webkit-search-cancel-button,
  .mn-search input::-webkit-search-decoration {
    -webkit-appearance: none;
    appearance: none;
  }

  /* 3x2 category grid (Apple cards) */
  .mn-home-page .mn-category-row {
    margin: 36px 28px 0 !important;
    display: grid !important;
    grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
    align-items: stretch !important;
    gap: 8px !important;
    overflow: visible !important;
    padding: 0 !important;
  }

  .mn-home-page .mn-category-button {
    width: 100% !important;
    height: 56px !important;
    min-width: 0 !important;
    padding: 0 8px !important;
    border: 0.5px solid var(--mn-border) !important;
    border-radius: 14px !important;
    background: var(--mn-surface) !important;
    color: var(--mn-text) !important;
    font-size: 16px !important;
    font-family: var(--mn-sans) !important;
    font-weight: 500 !important;
    white-space: nowrap !important;
    cursor: pointer;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    text-decoration: none;
    box-sizing: border-box;
    letter-spacing: -0.02em !important;
    transition: transform 0.12s ease, background 0.15s ease;
  }

  html.dark .mn-home-page .mn-category-button,
  html[data-theme="dark"] .mn-home-page .mn-category-button {
    background: var(--mn-surface) !important;
    border-color: var(--mn-border-soft) !important;
    color: var(--mn-text) !important;
  }

  .mn-home-page .mn-category-button:active,
  .mn-home-page .mn-preview-button:active {
    transform: scale(0.97);
  }

  /* Apple News-style preview card */
  .mn-home-page .mn-preview-card {
    width: auto !important;
    margin: 36px 20px 0 !important;
    display: flex !important;
    flex-direction: column !important;
    border: 0 !important;
    border-radius: 22px !important;
    background: var(--mn-surface) !important;
    box-shadow:
      0 1px 0 rgba(0,0,0,0.04),
      0 8px 32px rgba(0,0,0,0.04) !important;
    overflow: hidden !important;
    text-align: left !important;
  }

  html.dark .mn-home-page .mn-preview-card,
  html[data-theme="dark"] .mn-home-page .mn-preview-card {
    background: var(--mn-surface) !important;
    box-shadow: none !important;
    border: 0.5px solid var(--mn-border-soft) !important;
  }

  .mn-home-page .mn-preview-word {
    padding: 28px 28px 24px !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
  }

  .mn-home-page .mn-preview-word-title {
    font-family: var(--mn-serif) !important;
    font-size: 40px !important;
    line-height: 1 !important;
    font-weight: 400 !important;
    letter-spacing: -0.025em !important;
    margin: 0 !important;
    color: var(--mn-text) !important;
  }

  .mn-home-page .mn-preview-meaning {
    margin: 18px 0 0 !important;
    font-size: 17px !important;
    color: var(--mn-text) !important;
    line-height: 1.5 !important;
    font-weight: 400 !important;
    letter-spacing: -0.02em !important;
  }

  .mn-home-page .mn-preview-pronunciation {
    margin: 10px 0 0 !important;
    font-size: 15px !important;
    color: var(--mn-text-faint) !important;
    font-weight: 400 !important;
  }

  .mn-home-page .mn-preview-definition {
    margin: 18px 0 0 !important;
    max-width: 100% !important;
    font-size: 15px !important;
    line-height: 1.55 !important;
    color: var(--mn-text-muted) !important;
    font-weight: 300 !important;
    letter-spacing: -0.01em !important;
  }

  .mn-home-page .mn-preview-button {
    margin-top: 24px !important;
    width: fit-content !important;
    height: 40px !important;
    padding: 0 20px !important;
    border: 0.5px solid var(--mn-border) !important;
    border-radius: 100px !important;
    background: transparent !important;
    color: var(--mn-text) !important;
    font-size: 15px !important;
    font-family: var(--mn-sans) !important;
    font-weight: 400 !important;
    cursor: pointer;
    display: inline-flex !important;
    align-items: center !important;
    gap: 8px !important;
    justify-content: center !important;
    letter-spacing: -0.01em !important;
  }

  html.dark .mn-home-page .mn-preview-button,
  html[data-theme="dark"] .mn-home-page .mn-preview-button {
    border-color: var(--mn-border-soft) !important;
  }

  /* Hide the mini word graph on mobile — Apple-style preview is text-only */
  .mn-home-page .mn-preview-graph {
    display: none !important;
  }

  /* Hide the scroll cue arrow — too noisy for Apple style */
  .mn-home-page .mn-scroll-cue {
    display: none !important;
  }
}

@media (max-width: 768px) and (prefers-color-scheme: dark) {
  html[data-theme="system"] .mn-home-page {
    --mn-bg: #000000;
    --mn-surface: #1C1C1E;
    --mn-surface-soft: #2C2C2E;
    --mn-text: #FFFFFF;
    --mn-text-muted: rgba(255,255,255,0.6);
    --mn-text-faint: rgba(255,255,255,0.42);
    --mn-text-quaternary: rgba(255,255,255,0.25);
    --mn-border: rgba(255,255,255,0.10);
    --mn-border-soft: rgba(255,255,255,0.06);
    color-scheme: dark;
  }

  html[data-theme="system"] .mn-topbar {
    background: rgba(0,0,0,0.72);
  }

  html[data-theme="system"] .mn-search {
    background: rgba(118,118,128,0.24);
  }

  html[data-theme="system"] .mn-search:focus-within {
    background: rgba(118,118,128,0.36);
  }

  html[data-theme="system"] .mn-home-theme-button {
    background: rgba(255,255,255,0.10);
  }

  html[data-theme="system"] .mn-category-button {
    background: var(--mn-surface);
    border-color: var(--mn-border-soft);
  }

  html[data-theme="system"] .mn-preview-card {
    background: var(--mn-surface);
    box-shadow: none;
    border: 0.5px solid var(--mn-border-soft);
  }

  html[data-theme="system"] .mn-preview-button {
    border-color: var(--mn-border-soft);
  }
}

@media (max-width: 360px) {
  .mn-hero { padding: 48px 24px 0; }
  .mn-home-search-wrap { margin: 32px 24px 0; }
  .mn-category-row {
    margin: 32px 24px 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .mn-preview-card { margin: 32px 16px 0; }
}
`;

export default async function HomePage() {
  const user = await getSessionUser();
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
          <PublicTopBar
            user={user}
            breadcrumbs={[{ label: "首页" }]}
            showBackButton={false}
            themeVariant="segmented"
          />

          <section className="mn-hero" aria-labelledby="home-hero-title">
            <h1 id="home-hero-title" className="mn-hero-title">
              mnemonic
            </h1>
            <p className="mn-hero-subtitle">用联想，记住英语单词</p>

            <HomeWordSearch categories={categories} isAuthenticated={Boolean(user)} />

            <div className="mn-scroll-cue" aria-hidden="true">
              <span />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
