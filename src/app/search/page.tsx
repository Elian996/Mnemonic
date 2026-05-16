import Link from "next/link";
import { MemoryNodeType, WordStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { hasRole } from "@/lib/permissions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export default async function SearchPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string; level?: string; status?: string }>;
}) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const user = await getCurrentUser();
  const canEdit = hasRole(user, "EDITOR");
  const [words, nodes] = q
    ? await Promise.all([
        prisma.word.findMany({
          where: {
            AND: [
              params.status ? { status: params.status as WordStatus } : {},
              params.level ? { levelTags: { has: params.level as never } } : {},
              {
                OR: [
                  { word: { contains: q, mode: "insensitive" } },
                  { meaningCn: { contains: q, mode: "insensitive" } },
                  { shortMeaningCn: { contains: q, mode: "insensitive" } }
                ]
              }
            ]
          },
          include: { mnemonicEntries: { where: { sourceType: "OFFICIAL", status: { in: ["APPROVED", "FEATURED"] } } } },
          take: 30
        }),
        prisma.memoryNode.findMany({
          where: {
            OR: [
              { value: { contains: q, mode: "insensitive" } },
              { meaningCn: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } }
            ]
          },
          take: 30
        })
      ])
    : [[], []];

  return (
    <InteriorPage>
      <InteriorContainer wide>
        <InteriorHero
          eyebrow="search"
          title="搜索"
          description="在单词、中文释义、词根、前缀和后缀之间快速穿行，找到下一条记忆线索。"
          meta={q ? `当前关键词：${q}` : "输入关键词后开始筛选"}
        />

      <form className="mt-8 grid gap-3 md:grid-cols-[1fr_180px_180px_auto]">
        <Input name="q" defaultValue={q} placeholder="word / 中文 / root / prefix / suffix" />
        <select name="level" defaultValue={params.level ?? ""} className="h-10 rounded-md border bg-white px-3">
          <option value="">全部等级</option>
          <option value="LEVEL_2">二级</option>
          <option value="LEVEL_3">三级</option>
          <option value="COMPULSORY_EDUCATION">义务教育</option>
          <option value="PRIMARY">小学</option>
          <option value="MIDDLE_SCHOOL">初中</option>
          <option value="HIGH_SCHOOL">高中</option>
          <option value="GAOKAO_3500">高考3500</option>
          <option value="CET4">四级</option>
          <option value="CET6">六级</option>
        </select>
        <select name="status" defaultValue={params.status ?? ""} className="h-10 rounded-md border bg-white px-3">
          <option value="">全部状态</option>
          <option value="PUBLISHED">已发布</option>
          <option value="EMPTY">空白</option>
          <option value="DRAFT">草稿</option>
        </select>
        <Button>搜索</Button>
      </form>
      <section className="mt-8 grid gap-6 lg:grid-cols-2">
        <InteriorPanel className="p-5">
          <h2 className="font-serif text-2xl font-semibold">单词</h2>
          <div className="mt-4 space-y-3">
          {words.map((word) => (
            <Link key={word.id} href={`/word/${word.slug}`} className="mn-link-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{word.word}</span>
                <StatusBadge value={word.status} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{word.shortMeaningCn}</p>
              <div className="mt-2 flex items-center gap-2">
                <Badge>{word.mnemonicEntries.length ? "有官方助记" : "暂无官方助记"}</Badge>
                {canEdit ? <Badge>可编辑</Badge> : null}
              </div>
            </Link>
          ))}
          </div>
        </InteriorPanel>
        <InteriorPanel className="p-5">
          <h2 className="font-serif text-2xl font-semibold">记忆节点</h2>
          <div className="mt-4 space-y-3">
          {nodes.map((node) => (
            <Link
              key={node.id}
              href={node.type === MemoryNodeType.WORD ? `/word/${node.slug}` : `/node/${node.type.toLowerCase()}/${node.slug}`}
              className="mn-link-card p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{node.displayName}</span>
                <Badge>{node.type}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{node.meaningCn || node.description}</p>
            </Link>
          ))}
          </div>
        </InteriorPanel>
      </section>
      </InteriorContainer>
    </InteriorPage>
  );
}
