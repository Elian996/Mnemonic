import { LoadingBox } from "@/components/loading-line";

export default function RepositoryLoading() {
  return (
    <main className="mn-site-loading" aria-label="Loading">
      <LoadingBox label="Loading" />
    </main>
  );
}
