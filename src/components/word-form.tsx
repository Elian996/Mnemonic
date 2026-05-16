import { LevelTag, Word, WordStatus } from "@prisma/client";
import { saveWordAction, deleteWordAction } from "@/lib/services/word-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AutofillWordButton } from "@/components/autofill-word-button";

export function WordForm({
  word,
  compact = false,
  returnTo = "admin"
}: {
  word?: Word;
  compact?: boolean;
  returnTo?: "admin" | "word";
}) {
  const levels: LevelTag[] = ["LEVEL_2", "LEVEL_3", "COMPULSORY_EDUCATION", "PRIMARY", "MIDDLE_SCHOOL", "HIGH_SCHOOL", "GAOKAO_3500", "CET4", "CET6", "POSTGRADUATE", "IELTS", "TOEFL"];
  const statuses: WordStatus[] = ["EMPTY", "DRAFT", "READY", "PUBLISHED", "NEEDS_REVISION"];
  if (compact) {
    return (
      <form action={saveWordAction} className="grid gap-4">
        {word ? <input type="hidden" name="id" value={word.id} /> : null}
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="phoneticUs" value={word?.phoneticUs ?? ""} />
        <input type="hidden" name="partOfSpeech" value={word?.partOfSpeech ?? "n."} />
        <input type="hidden" name="shortMeaningCn" value={word?.shortMeaningCn ?? ""} />
        <input type="hidden" name="meaningEn" value={word?.meaningEn ?? ""} />
        <input type="hidden" name="exampleSentence" value={word?.exampleSentence ?? ""} />
        <input type="hidden" name="exampleTranslation" value={word?.exampleTranslation ?? ""} />
        <input type="hidden" name="difficulty" value={word?.difficulty ?? 3} />
        <input type="hidden" name="status" value={word?.status ?? "EMPTY"} />
        <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Input
            name="word"
            defaultValue={word?.word ?? ""}
            placeholder="单词"
            required
            className="h-12 rounded-lg bg-background text-base"
          />
          <AutofillWordButton />
        </div>
        <Input
          name="phoneticUk"
          defaultValue={word?.phoneticUk ?? word?.phoneticUs ?? ""}
          placeholder="音标，例如 /pʊt/"
          className="h-12 rounded-lg bg-background text-base"
        />
        <Textarea
          name="meaningCn"
          defaultValue={word?.meaningCn ?? ""}
          placeholder="意思，例如 放；摆；使处于"
          required
          className="min-h-32 rounded-lg bg-background text-base leading-7"
        />
        <Button className="h-12 w-fit rounded-full px-6">保存</Button>
      </form>
    );
  }

  return (
    <form action={saveWordAction} className="grid gap-4 rounded-lg border bg-card p-5 text-card-foreground lg:grid-cols-2">
      {word ? <input type="hidden" name="id" value={word.id} /> : null}
      <input type="hidden" name="returnTo" value={returnTo} />
      <div className="flex gap-2 lg:col-span-2">
        <Input name="word" defaultValue={word?.word ?? ""} placeholder="word" required />
        <AutofillWordButton />
      </div>
      <Input name="slug" defaultValue={word?.slug ?? ""} placeholder="slug" />
      <Input name="phoneticUk" defaultValue={word?.phoneticUk ?? ""} placeholder="音标，例如 /həˈræŋ/" />
      <Input name="phoneticUs" defaultValue={word?.phoneticUs ?? ""} placeholder="美音音标" />
      <Input name="audioUkUrl" defaultValue={word?.audioUkUrl ?? ""} placeholder="英音音频 URL" />
      <Input name="audioUsUrl" defaultValue={word?.audioUsUrl ?? ""} placeholder="美音音频 URL" />
      <Input name="partOfSpeech" defaultValue={word?.partOfSpeech ?? ""} placeholder="词性" required />
      <Input name="shortMeaningCn" defaultValue={word?.shortMeaningCn ?? ""} placeholder="短中文释义" required />
      <Textarea name="meaningCn" defaultValue={word?.meaningCn ?? ""} placeholder="中文释义" required className="lg:col-span-2" />
      <Textarea name="meaningEn" defaultValue={word?.meaningEn ?? ""} placeholder="英文释义" className="lg:col-span-2" />
      <Input name="exampleSentence" defaultValue={word?.exampleSentence ?? ""} placeholder="英文例句" className="lg:col-span-2" />
      <Input name="exampleTranslation" defaultValue={word?.exampleTranslation ?? ""} placeholder="例句翻译" className="lg:col-span-2" />
      <Input name="frequencyRank" type="number" defaultValue={word?.frequencyRank ?? ""} placeholder="频率排名" />
      <Input name="difficulty" type="number" min={1} max={5} defaultValue={word?.difficulty ?? 3} placeholder="难度 1-5" />
      <div className="lg:col-span-2">
        <div className="mb-2 text-sm font-medium">等级标签</div>
        <div className="flex flex-wrap gap-3">
          {levels.map((level) => <label key={level} className="text-sm"><input type="checkbox" name="levelTags" value={level} defaultChecked={word?.levelTags.includes(level)} /> {level}</label>)}
        </div>
      </div>
      <select name="status" defaultValue={word?.status ?? "EMPTY"} className="h-10 rounded-md border bg-card px-3">
        {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      <div className="flex gap-2">
        <Button>保存</Button>
      </div>
    </form>
  );
}

export function DeleteWordForm({ id }: { id: string }) {
  return (
    <form action={deleteWordAction}>
      <input type="hidden" name="id" value={id} />
      <Button variant="destructive">确认删除</Button>
    </form>
  );
}
