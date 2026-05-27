ALTER TYPE "VoteType" ADD VALUE IF NOT EXISTS 'DISLIKE';

ALTER TABLE "User"
  ADD COLUMN "wordCardContributionCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MnemonicEntry"
  ADD COLUMN "dislikeCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "User" u
SET "wordCardContributionCount" = approved.count
FROM (
  SELECT "authorId", COUNT(*)::INTEGER AS count
  FROM "MnemonicEntry"
  WHERE "sourceType" = 'USER_PUBLIC'
    AND "status" IN ('APPROVED', 'FEATURED')
    AND "isPublic" = true
  GROUP BY "authorId"
) approved
WHERE u.id = approved."authorId";
