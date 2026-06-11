import Link from "next/link";

const ICP_NUMBER = "浙ICP备2026041723号-1";
const ICP_HREF = "https://beian.miit.gov.cn/";

export function SiteFooter() {
  return (
    <footer className="border-t border-[#d2cabd] bg-[#fffaf0] text-[#6b6457] dark:border-[#484036] dark:bg-[#191714] dark:text-[#9b9384]">
      <div className="container flex flex-col items-center justify-center gap-1 py-5 text-center text-xs">
        <Link
          href={ICP_HREF}
          target="_blank"
          rel="noreferrer"
          className="transition hover:text-[#13110e] dark:hover:text-[#f5f1e8]"
        >
          {ICP_NUMBER}
        </Link>
      </div>
    </footer>
  );
}
