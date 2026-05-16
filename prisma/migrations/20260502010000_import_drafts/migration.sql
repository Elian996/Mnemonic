CREATE TYPE "ImportDraftStatus" AS ENUM ('DRAFT', 'SAVED', 'DISCARDED');

CREATE TABLE "ImportDraft" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'external-agent',
  "status" "ImportDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "word" TEXT NOT NULL,
  "phoneticUk" TEXT,
  "phoneticUs" TEXT,
  "partOfSpeech" TEXT,
  "meaningCn" TEXT,
  "meaningEn" TEXT,
  "shortMeaningCn" TEXT,
  "difficulty" INTEGER NOT NULL DEFAULT 3,
  "splitText" TEXT,
  "title" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "rawText" TEXT,
  "originalImageUrl" TEXT,
  "extractedImageUrls" TEXT[],
  "agentPayload" JSONB NOT NULL,
  "savedWordId" TEXT,
  "savedEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportDraft_status_createdAt_idx" ON "ImportDraft"("status", "createdAt");
CREATE INDEX "ImportDraft_word_idx" ON "ImportDraft"("word");
