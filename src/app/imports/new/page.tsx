import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ImportImageUploadForm } from "@/components/import-image-upload-form";
import { ImportMarkdownForm } from "@/components/import-markdown-form";
import { getUserWithRole } from "@/lib/auth/session";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export default async function NewImportPage() {
  const admin = await getUserWithRole(UserRole.ADMIN);
  if (!admin) notFound();

  return (
    <InteriorPage>
      <InteriorContainer>
      <Link href="/imports" className="text-sm font-semibold text-[var(--mn-muted)] hover:text-[var(--mn-ink)]">← 返回导入草稿</Link>
      <InteriorHero
        eyebrow="new import"
        title="导入草稿"
        description="支持粘贴 Markdown、上传 Markdown 文件，也支持上传包含单词记忆方法的截图。所有内容都会先生成可编辑草稿，确认后再保存为正式记忆卡。"
        meta="先草稿，后入库"
        className="mt-4"
      />
      <div className="mt-6">
        <ImportMarkdownForm />
      </div>
      <div className="mt-6">
        <ImportImageUploadForm />
      </div>
      <InteriorPanel className="mt-6 p-5 text-sm leading-7 text-muted-foreground">
        <p>Markdown 批量导入和图片导入都会使用 AI 生成结构化草稿。可在 AI 设置里填写浏览器本地 Key，也可以配置 <code className="rounded bg-muted px-1">OPENAI_API_KEY</code> 或 <code className="rounded bg-muted px-1">AI_AGENT_API_KEY</code>。</p>
        <p className="mt-2">图片在未配置 AI 时仍会尝试本机 OCR；Markdown 批量拆分需要 AI，因为它要判断多词条边界和字段归属。</p>
      </InteriorPanel>
      </InteriorContainer>
    </InteriorPage>
  );
}
