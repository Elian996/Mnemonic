ALTER TABLE "MnemonicEntry" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "MnemonicEntry_targetWordId_sourceType_sortOrder_idx" ON "MnemonicEntry"("targetWordId", "sourceType", "sortOrder");
