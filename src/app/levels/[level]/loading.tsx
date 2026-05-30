import { LoadingLine } from "@/components/loading-line";

export default function LevelLoading() {
  return (
    <main className="mn-level-page mn-level-loading" aria-label="正在打开词库">
      <LoadingLine label="正在打开词库" />
    </main>
  );
}
