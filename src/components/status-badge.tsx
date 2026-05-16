import { Badge } from "@/components/ui/badge";

const labels: Record<string, string> = {
  EMPTY: "空白",
  DRAFT: "草稿",
  READY: "待发布",
  PUBLISHED: "已发布",
  NEEDS_REVISION: "需修订",
  PRIVATE: "私有",
  PENDING_REVIEW: "待审核",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  FEATURED: "精选",
  ARCHIVED: "已归档",
  ADMIN: "管理员",
  EDITOR: "编辑",
  REVIEWER: "审核员",
  CONTRIBUTOR: "贡献者",
  USER: "用户"
};

export function StatusBadge({ value }: { value: string }) {
  return <Badge>{labels[value] ?? value}</Badge>;
}
