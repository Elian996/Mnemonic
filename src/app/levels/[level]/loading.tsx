import { LoadingBox } from "@/components/loading-line";

export default function LevelLoading() {
  return (
    <main className="mn-level-page mn-level-loading" aria-label="Loading">
      <LoadingBox label="Loading" />
    </main>
  );
}
