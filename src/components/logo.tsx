import Link from "next/link";

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <span className={`${className} inline-flex overflow-hidden rounded-[3px] bg-[#f7f3ea] ring-1 ring-[#171717]/20`} aria-hidden="true">
      <img src="/mnemonic-logo.png" alt="" className="h-full w-full scale-[1.55] object-cover object-center" />
    </span>
  );
}

export function LogoLockup() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3 text-[#13110e] dark:text-[#f5f1e8]">
      <LogoMark className="h-9 w-9" />
      <span className="font-serif text-2xl font-semibold tracking-normal transition group-hover:text-[#f42732]">mnemonic</span>
    </Link>
  );
}
