-- CreateEnum
CREATE TYPE "WordMarkState" AS ENUM ('KNOWN', 'FUZZY', 'UNKNOWN');

-- CreateTable
CREATE TABLE "WordMark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "state" "WordMarkState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WordMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WordMark_userId_wordId_key" ON "WordMark"("userId", "wordId");

-- CreateIndex
CREATE INDEX "WordMark_userId_state_idx" ON "WordMark"("userId", "state");

-- CreateIndex
CREATE INDEX "WordMark_wordId_idx" ON "WordMark"("wordId");

-- AddForeignKey
ALTER TABLE "WordMark" ADD CONSTRAINT "WordMark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordMark" ADD CONSTRAINT "WordMark_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
