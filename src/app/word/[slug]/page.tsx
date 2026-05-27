import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, ExternalLink, Trash2 } from "lucide-react";
import { UserRole } from "@prisma/client";
import {
  archiveOfficialMnemonicAction,
  getWordPageData,
  reorderOfficialMnemonicAction,
  saveOfficialMnemonicAction,
  saveUserMnemonicAction,
  setUserMnemonicPublicAction
} from "@/lib/services/mnemonic-service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MnemonicEditor } from "@/components/mnemonic-editor";
import { StatusBadge } from "@/components/status-badge";
import { WikiRichText } from "@/components/wiki-rich-text";
import { WordForm } from "@/components/word-form";
import { hasRole } from "@/lib/permissions";
import { type VocabCategory, vocabCategoryByTag } from "@/lib/vocab-categories";
import { InteriorContainer, InteriorHero, InteriorPage } from "@/components/interior-shell";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await getWordPageData(slug);
  if (!data) return {};
  return {
    title: `${data.word.word} | mnemonic 编辑器`,
    description: `${data.word.word}：${data.word.shortMeaningCn}`
  };
}

export default async function WordPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getWordPageData(slug);
  if (!data) notFound();

  const { user, word, officialEntries, publicEntries, userEntries, backlinks, directLinks } = data;
  const canEditOfficial = hasRole(user, UserRole.EDITOR);
  const displayEntries = [...officialEntries, ...publicEntries].sort(compareDisplayMnemonicEntries);
  const outgoingLinks = [...directLinks, ...displayEntries.flatMap((item) => item.links)];
  const linkedWordNodes = outgoingLinks.filter((link) => link.targetNode.type === "WORD");
  const categories = word.levelTags
    .map((tag) => vocabCategoryByTag[tag])
    .filter((category): category is VocabCategory => Boolean(category));

  return (
    <InteriorPage>
      <InteriorContainer wide>
      <Link href="/" className="text-sm font-semibold text-[var(--mn-muted)] hover:text-[var(--mn-ink)]">← 返回编辑工作台</Link>
      <InteriorHero
        eyebrow="word card"
        title={word.word}
        description={
          <>
            <span className="block">{word.phoneticUk || word.phoneticUs || "未录入音标"}</span>
            <span className="mt-2 block whitespace-pre-line">{word.meaningCn}</span>
          </>
        }
        meta={`${displayEntries.length.toLocaleString("zh-CN")} 张记忆卡 / ${outgoingLinks.length.toLocaleString("zh-CN")} 个链接`}
        actions={
          <>
          {categories.map((category) => (
            <Badge key={category.tag} title={category.description}>{category.label}</Badge>
          ))}
          <StatusBadge value={word.status} />
          <Badge>本地编辑</Badge>
          </>
        }
        className="mb-6 mt-4"
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
          <header className="border-b p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-5xl font-bold tracking-normal text-[#27251d]">{word.word}</h2>
                <p className="mt-3 text-lg text-muted-foreground">
                  {word.phoneticUk || word.phoneticUs || "未录入音标"}
                </p>
                {categories.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categories.map((category) => (
                      <Badge key={category.tag} title={category.description}>{category.label}</Badge>
                    ))}
                  </div>
                ) : null}
                {categories.length ? (
                  <div className="mt-3 space-y-1 text-sm leading-6 text-muted-foreground">
                    {categories.map((category) => (
                      <p key={category.tag}>{category.label}：{category.description}</p>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2 text-2xl text-[#27251d]">
                <span aria-hidden>⌑</span>
                <span aria-hidden>◔</span>
              </div>
            </div>
            <p className="mt-5 whitespace-pre-line text-2xl leading-10 text-[#3b382f]">{word.meaningCn}</p>
          </header>

          <article className="space-y-6 p-5">
            <h3 className="text-2xl font-bold text-[#27251d]">记忆卡</h3>
            {displayEntries.length ? (
              displayEntries.map((item, index) => (
                <section key={item.id} className={index ? "border-t pt-6" : ""}>
                  {displayEntries.length > 1 ? (
                    <div className="mb-3 text-sm font-semibold text-muted-foreground">记忆卡 {index + 1}</div>
                  ) : null}
                  {item.splitText ? (
                    <p className="text-xl leading-9 text-[#3b382f]">划分：{item.splitText}</p>
                  ) : null}
                  <div className="mt-2 text-xl leading-9 text-[#3b382f]">
                    <WikiRichText html={item.contentHtml} />
                  </div>
                </section>
              ))
            ) : (
              <p className="mt-4 text-muted-foreground">还没有记忆方法。请在右侧录入并保存。</p>
            )}
          </article>

          <footer className="border-t p-5">
            <div className="mb-3 text-sm text-muted-foreground">链接（{outgoingLinks.length}个）</div>
            <div className="space-y-3">
              {linkedWordNodes.slice(0, 8).map((link) => (
                <Link
                  key={link.id}
                  href={`/word/${link.targetNode.slug}`}
                  className="flex items-center justify-between rounded-lg border bg-background p-4 hover:bg-muted"
                >
                  <div>
                    <div className="text-xl font-semibold">{link.targetNode.displayName}</div>
                    <div className="mt-1 text-sm text-muted-foreground">{link.targetNode.meaningCn}</div>
                  </div>
                  <span className="text-2xl text-muted-foreground">›</span>
                </Link>
              ))}
              {outgoingLinks.filter((link) => link.targetNode.type !== "WORD").length ? (
                <div className="flex flex-wrap gap-2">
                  {outgoingLinks
                    .filter((link) => link.targetNode.type !== "WORD")
                    .map((link) => (
                      <Link key={link.id} href={`/node/${link.targetNode.type.toLowerCase()}/${link.targetNode.slug}`}>
                        <Badge>{link.targetNode.type}:{link.targetNode.displayName}</Badge>
                      </Link>
                    ))}
                </div>
              ) : null}
            </div>
          </footer>
        </section>

        <section className="space-y-6">
          {canEditOfficial ? (
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">单词信息</h2>
              <p className="mt-1 text-sm text-muted-foreground">保存只会更新当前单词，不会影响助记内容。</p>
              <div className="mt-4">
                <WordForm word={word} compact returnTo="word" />
              </div>
            </div>
          ) : null}

          {canEditOfficial ? (
            <div className="rounded-xl border bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">官方记忆方法</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                支持一个单词保存多张记忆卡。默认按发布时间从早到晚显示，也可以用上移/下移自由排序。
              </p>
              <div className="mt-4 space-y-6">
                {officialEntries.map((item, index) => (
                  <section key={item.id} className="rounded-2xl border bg-background/60 p-4">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-base font-semibold">记忆卡 {index + 1}</h3>
                      <div className="flex gap-2">
                        <form action={reorderOfficialMnemonicAction}>
                          <input type="hidden" name="entryId" value={item.id} />
                          <input type="hidden" name="direction" value="up" />
                          <input type="hidden" name="returnTo" value="word" />
                          <Button type="submit" variant="outline" size="sm" disabled={index === 0}>
                            <ArrowUp className="h-4 w-4" />
                            上移
                          </Button>
                        </form>
                        <form action={reorderOfficialMnemonicAction}>
                          <input type="hidden" name="entryId" value={item.id} />
                          <input type="hidden" name="direction" value="down" />
                          <input type="hidden" name="returnTo" value="word" />
                          <Button type="submit" variant="outline" size="sm" disabled={index === officialEntries.length - 1}>
                            <ArrowDown className="h-4 w-4" />
                            下移
                          </Button>
                        </form>
                        <form action={archiveOfficialMnemonicAction}>
                          <input type="hidden" name="entryId" value={item.id} />
                          <input type="hidden" name="returnTo" value="word" />
                          <Button type="submit" variant="destructive" size="sm">
                            <Trash2 className="h-4 w-4" />
                            删除
                          </Button>
                        </form>
                      </div>
                    </div>
                    <MnemonicEditor
                      action={saveOfficialMnemonicAction}
                      targetWordId={word.id}
                      mode="official"
                      entry={item}
                      returnTo="word"
                    />
                  </section>
                ))}

                <section className="rounded-2xl border border-dashed bg-background/60 p-4">
                  <h3 className="mb-4 text-base font-semibold">新增官方记忆卡</h3>
                  <MnemonicEditor
                    action={saveOfficialMnemonicAction}
                    targetWordId={word.id}
                    mode="official"
                    returnTo="word"
                  />
                </section>
              </div>
            </div>
          ) : null}

          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">我的记忆卡</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  普通账号只能管理自己创建的记忆卡。默认公开开启时，保存会自动提交审核。
                </p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/me/mnemonics">
                  <ExternalLink className="h-4 w-4" />
                  管理我的记忆卡
                </Link>
              </Button>
            </div>
            {user ? (
              <div className="mt-4 space-y-4">
                {userEntries.length ? (
                  <div className="space-y-2">
                    {userEntries.map((entry) => (
                      <div key={entry.id} className="rounded-md border bg-background/60 p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold">{entry.title}</span>
                          <StatusBadge value={entry.status} />
                        </div>
                        <p className="mt-1 line-clamp-2 text-muted-foreground">{entry.plainText}</p>
                        <form action={setUserMnemonicPublicAction} className="mt-3">
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="returnTo" value="word" />
                          <input
                            type="hidden"
                            name="intent"
                            value={entry.sourceType === "USER_PUBLIC" && entry.status !== "REJECTED" ? "private" : "public"}
                          />
                          <Button type="submit" variant="outline" size="sm">
                            {entry.sourceType === "USER_PUBLIC" && entry.status !== "REJECTED" ? "取消公开" : "提交审核"}
                          </Button>
                        </form>
                      </div>
                    ))}
                  </div>
                ) : null}
                <section className="rounded-2xl border border-dashed bg-background/60 p-4">
                  <h3 className="mb-4 text-base font-semibold">新增我的记忆卡</h3>
                  <MnemonicEditor
                    action={saveUserMnemonicAction}
                    targetWordId={word.id}
                    mode={user.defaultPublicMnemonics ? "public" : "private"}
                    returnTo="word"
                    showVisibilityChoice
                  />
                </section>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                <Link href="/login" className="font-semibold text-primary">登录</Link> 后可以创建自己的记忆卡。
              </p>
            )}
          </div>

          <div className="rounded-xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">反向引用</h2>
            <div className="mt-3 space-y-2">
              {backlinks.slice(0, 10).map((link) => (
                <div key={link.id} className="rounded-md border p-3 text-sm">
                  {link.sourceMnemonicEntry ? (
                    <Link href={`/word/${link.sourceMnemonicEntry.targetWord.slug}`}>
                      {link.sourceMnemonicEntry.targetWord.word} 的记忆方法引用了这个单词
                    </Link>
                  ) : (
                    <span>{link.sourceNode.displayName}</span>
                  )}
                </div>
              ))}
              {backlinks.length === 0 ? <p className="text-sm text-muted-foreground">暂无反向引用。</p> : null}
            </div>
          </div>
        </section>
      </div>
      </InteriorContainer>
    </InteriorPage>
  );
}

function compareDisplayMnemonicEntries(
  first: { likeCount: number; dislikeCount?: number; sortOrder: number; createdAt: Date; id: string },
  second: { likeCount: number; dislikeCount?: number; sortOrder: number; createdAt: Date; id: string }
) {
  const firstFeedbackScore = mnemonicFeedbackScore(first);
  const secondFeedbackScore = mnemonicFeedbackScore(second);
  if (firstFeedbackScore !== secondFeedbackScore) return secondFeedbackScore - firstFeedbackScore;
  if (first.sortOrder !== second.sortOrder) return first.sortOrder - second.sortOrder;
  const createdCompare = first.createdAt.getTime() - second.createdAt.getTime();
  return createdCompare || first.id.localeCompare(second.id);
}

function mnemonicFeedbackScore(entry: { likeCount: number; dislikeCount?: number }) {
  return entry.likeCount - (entry.dislikeCount ?? 0);
}
