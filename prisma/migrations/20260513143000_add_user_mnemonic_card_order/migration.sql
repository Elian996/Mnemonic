CREATE TABLE "UserMnemonicCardOrder" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "mnemonicEntryId" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMnemonicCardOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserMnemonicCardOrder_userId_mnemonicEntryId_key" ON "UserMnemonicCardOrder"("userId", "mnemonicEntryId");
CREATE INDEX "UserMnemonicCardOrder_userId_wordId_sortOrder_idx" ON "UserMnemonicCardOrder"("userId", "wordId", "sortOrder");

ALTER TABLE "UserMnemonicCardOrder" ADD CONSTRAINT "UserMnemonicCardOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMnemonicCardOrder" ADD CONSTRAINT "UserMnemonicCardOrder_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMnemonicCardOrder" ADD CONSTRAINT "UserMnemonicCardOrder_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
