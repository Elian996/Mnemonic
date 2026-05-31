import { LoadingBox } from "@/components/loading-line";

export default function RepositoryLoading() {
  return (
    <main className="mn-site-loading" aria-label="正在打开管理员中心">
      <LoadingBox label="正在打开管理员中心" />
    </main>
  );
}
