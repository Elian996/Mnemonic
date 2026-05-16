import Link from "next/link";
import { AiSettingsForm } from "@/components/ai-settings-form";
import { InteriorContainer, InteriorHero, InteriorPage, InteriorPanel } from "@/components/interior-shell";

export default function AiSettingsPage() {
  return (
    <InteriorPage>
      <InteriorContainer>
        <Link href="/" className="text-sm font-semibold text-[var(--mn-muted)] transition hover:text-[var(--mn-ink)]">返回工作台</Link>
        <InteriorHero
          eyebrow="settings"
          title="AI 工作流设置"
          description="自动填写和图片导入共用这里的配置。API Key 只保存在当前浏览器，不写入数据库。"
          meta="browser local only"
          className="mt-4"
        />
        <div className="mt-8">
          <AiSettingsForm />
        </div>
        <InteriorPanel className="mt-8 grid gap-4 p-6 text-sm leading-7">
          <p>当前默认 LLM：<strong>gpt-4.1-mini</strong>。</p>
          <p>自动填写：把单词发送给同一个模型，让它只返回音标、词性、中文释义、英文释义、短释义和难度。</p>
          <p>图片导入：把截图发送给同一个视觉模型，让它 OCR 并返回结构化卡片 JSON，再保存为导入草稿。</p>
          <p>如果你使用第三方 OpenAI-compatible 服务，把 Base URL 和模型名改成对方提供的值即可。</p>
        </InteriorPanel>
      </InteriorContainer>
    </InteriorPage>
  );
}
