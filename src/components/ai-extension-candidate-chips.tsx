import { Sparkles } from "lucide-react";
import type { AiExtensionCandidate } from "@/lib/ai-extension-route-fill";
import { createAiExtensionDraftAction } from "@/lib/services/ai-extension-service";
import { Button } from "@/components/ui/button";

export function AiExtensionCandidateChips({
  baseWordId,
  candidates,
  returnTo
}: {
  baseWordId: string;
  candidates: AiExtensionCandidate[];
  returnTo: string;
}) {
  if (!candidates.length) return null;

  return (
    <section className="mt-5 rounded-2xl border border-dashed border-[#cbd3df] bg-[#f8fafc] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#475569]">
          <Sparkles className="h-4 w-4" />
          AI 延伸候选
        </span>
        {candidates.map((candidate) => (
          <form key={`${candidate.targetWordId}:${candidate.ruleKey}`} action={createAiExtensionDraftAction}>
            <input type="hidden" name="baseWordId" value={baseWordId} />
            <input type="hidden" name="targetWordId" value={candidate.targetWordId} />
            <input type="hidden" name="ruleKey" value={candidate.ruleKey} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={Boolean(candidate.existingDraftId)}
              title={`${candidate.ruleLabel} · ${candidate.targetMeaning}`}
              className="h-8 rounded-full border-[#d7dde8] bg-white px-3 text-xs font-semibold text-[#1f2937] shadow-none hover:border-[#9aa8bb] hover:bg-white"
            >
              {candidate.targetWord}
              <span className="ml-1 text-[10px] font-medium text-[#64748b]">
                {candidate.existingDraftId ? "待审中" : candidate.ruleLabel}
              </span>
            </Button>
          </form>
        ))}
      </div>
      <p className="mt-2 text-xs leading-5 text-[#64748b]">
        只显示当前缺卡、可从这个单词自然延伸的目标词。点击后先生成待审草稿，不会直接发布。
      </p>
    </section>
  );
}
