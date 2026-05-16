import { WordForm } from "@/components/word-form";

export default function NewWordPage() {
  return (
    <main>
      <h1 className="text-3xl font-semibold">创建单词</h1>
      <div className="mt-6"><WordForm /></div>
    </main>
  );
}
