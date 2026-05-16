-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'REVIEWER', 'CONTRIBUTOR', 'USER');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "LevelTag" AS ENUM ('PRIMARY', 'MIDDLE_SCHOOL', 'HIGH_SCHOOL', 'CET4', 'CET6', 'POSTGRADUATE', 'IELTS', 'TOEFL');
CREATE TYPE "WordStatus" AS ENUM ('EMPTY', 'DRAFT', 'READY', 'PUBLISHED', 'NEEDS_REVISION');
CREATE TYPE "MemoryNodeType" AS ENUM ('WORD', 'ROOT', 'PREFIX', 'SUFFIX', 'BLOCK', 'SOUND', 'SCENE', 'BRIDGE', 'TOPIC');
CREATE TYPE "MnemonicSourceType" AS ENUM ('OFFICIAL', 'USER_PRIVATE', 'USER_PUBLIC');
CREATE TYPE "MnemonicStatus" AS ENUM ('PRIVATE', 'DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'FEATURED', 'ARCHIVED');
CREATE TYPE "RelationType" AS ENUM ('WIKI_LINK', 'BRIDGE', 'SAME_BLOCK', 'SAME_ROOT', 'PREFIX_LINK', 'SUFFIX_LINK', 'UNLOCKS', 'CONFUSABLE', 'SYNONYM', 'ANTONYM', 'EXAMPLE', 'CHAIN');
CREATE TYPE "ChainStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "VoteType" AS ENUM ('LIKE');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');
CREATE TYPE "ReviewCardState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'SUSPENDED');
CREATE TYPE "ReviewRating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateTable
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "avatarUrl" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "contributionScore" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Word" (
  "id" TEXT NOT NULL,
  "word" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "phoneticUk" TEXT,
  "phoneticUs" TEXT,
  "audioUkUrl" TEXT,
  "audioUsUrl" TEXT,
  "partOfSpeech" TEXT NOT NULL,
  "meaningCn" TEXT NOT NULL,
  "meaningEn" TEXT,
  "shortMeaningCn" TEXT NOT NULL,
  "levelTags" "LevelTag"[],
  "frequencyRank" INTEGER,
  "difficulty" INTEGER NOT NULL DEFAULT 3,
  "status" "WordStatus" NOT NULL DEFAULT 'EMPTY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Word_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryNode" (
  "id" TEXT NOT NULL,
  "type" "MemoryNodeType" NOT NULL,
  "value" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "meaningCn" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemoryNode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MnemonicEntry" (
  "id" TEXT NOT NULL,
  "targetWordId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "sourceType" "MnemonicSourceType" NOT NULL,
  "status" "MnemonicStatus" NOT NULL DEFAULT 'DRAFT',
  "title" TEXT NOT NULL,
  "splitText" TEXT,
  "contentMarkdown" TEXT NOT NULL,
  "contentHtml" TEXT NOT NULL,
  "plainText" TEXT NOT NULL,
  "editorNote" TEXT,
  "reviewNote" TEXT,
  "reviewerId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "isOfficialRecommended" BOOLEAN NOT NULL DEFAULT false,
  "isPublic" BOOLEAN NOT NULL DEFAULT false,
  "editorScore" INTEGER NOT NULL DEFAULT 0,
  "likeCount" INTEGER NOT NULL DEFAULT 0,
  "bookmarkCount" INTEGER NOT NULL DEFAULT 0,
  "reportCount" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "effectivenessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MnemonicEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MnemonicEntryVersion" (
  "id" TEXT NOT NULL,
  "mnemonicEntryId" TEXT NOT NULL,
  "contentMarkdown" TEXT NOT NULL,
  "splitText" TEXT,
  "title" TEXT NOT NULL,
  "editorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MnemonicEntryVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryLink" (
  "id" TEXT NOT NULL,
  "sourceNodeId" TEXT NOT NULL,
  "targetNodeId" TEXT NOT NULL,
  "sourceMnemonicEntryId" TEXT,
  "relationType" "RelationType" NOT NULL DEFAULT 'WIKI_LINK',
  "anchorText" TEXT NOT NULL,
  "description" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemoryLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryChain" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT,
  "createdById" TEXT NOT NULL,
  "status" "ChainStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemoryChain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemoryChainItem" (
  "id" TEXT NOT NULL,
  "chainId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "orderIndex" INTEGER NOT NULL,
  "note" TEXT,
  CONSTRAINT "MemoryChainItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Vote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mnemonicEntryId" TEXT NOT NULL,
  "type" "VoteType" NOT NULL DEFAULT 'LIKE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Bookmark" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "mnemonicEntryId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Bookmark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Report" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "mnemonicEntryId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "handledById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewCard" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "mnemonicEntryId" TEXT,
  "state" "ReviewCardState" NOT NULL DEFAULT 'NEW',
  "dueAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "intervalDays" INTEGER NOT NULL DEFAULT 0,
  "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  "repetitions" INTEGER NOT NULL DEFAULT 0,
  "lapses" INTEGER NOT NULL DEFAULT 0,
  "lastReviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReviewCard_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewLog" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wordId" TEXT NOT NULL,
  "mnemonicEntryId" TEXT,
  "rating" "ReviewRating" NOT NULL,
  "remembered" BOOLEAN NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- Indexes and constraints
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "Word_word_key" ON "Word"("word");
CREATE UNIQUE INDEX "Word_slug_key" ON "Word"("slug");
CREATE INDEX "Word_status_idx" ON "Word"("status");
CREATE INDEX "Word_word_idx" ON "Word"("word");
CREATE UNIQUE INDEX "MemoryNode_type_slug_key" ON "MemoryNode"("type", "slug");
CREATE INDEX "MemoryNode_type_idx" ON "MemoryNode"("type");
CREATE INDEX "MemoryNode_value_idx" ON "MemoryNode"("value");
CREATE INDEX "MnemonicEntry_targetWordId_sourceType_status_idx" ON "MnemonicEntry"("targetWordId", "sourceType", "status");
CREATE INDEX "MnemonicEntry_authorId_idx" ON "MnemonicEntry"("authorId");
CREATE INDEX "MnemonicEntry_status_idx" ON "MnemonicEntry"("status");
CREATE INDEX "MemoryLink_sourceNodeId_idx" ON "MemoryLink"("sourceNodeId");
CREATE INDEX "MemoryLink_targetNodeId_idx" ON "MemoryLink"("targetNodeId");
CREATE INDEX "MemoryLink_sourceMnemonicEntryId_idx" ON "MemoryLink"("sourceMnemonicEntryId");
CREATE UNIQUE INDEX "MemoryChain_slug_key" ON "MemoryChain"("slug");
CREATE UNIQUE INDEX "MemoryChainItem_chainId_orderIndex_key" ON "MemoryChainItem"("chainId", "orderIndex");
CREATE INDEX "MemoryChainItem_nodeId_idx" ON "MemoryChainItem"("nodeId");
CREATE UNIQUE INDEX "Vote_userId_mnemonicEntryId_type_key" ON "Vote"("userId", "mnemonicEntryId", "type");
CREATE UNIQUE INDEX "Bookmark_userId_wordId_mnemonicEntryId_key" ON "Bookmark"("userId", "wordId", "mnemonicEntryId");
CREATE UNIQUE INDEX "ReviewCard_userId_wordId_mnemonicEntryId_key" ON "ReviewCard"("userId", "wordId", "mnemonicEntryId");
CREATE INDEX "ReviewCard_userId_dueAt_idx" ON "ReviewCard"("userId", "dueAt");
CREATE INDEX "ReviewLog_userId_reviewedAt_idx" ON "ReviewLog"("userId", "reviewedAt");
CREATE INDEX "ReviewLog_mnemonicEntryId_idx" ON "ReviewLog"("mnemonicEntryId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- Foreign keys
ALTER TABLE "MnemonicEntry" ADD CONSTRAINT "MnemonicEntry_targetWordId_fkey" FOREIGN KEY ("targetWordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MnemonicEntry" ADD CONSTRAINT "MnemonicEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MnemonicEntry" ADD CONSTRAINT "MnemonicEntry_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MnemonicEntryVersion" ADD CONSTRAINT "MnemonicEntryVersion_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_sourceNodeId_fkey" FOREIGN KEY ("sourceNodeId") REFERENCES "MemoryNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_targetNodeId_fkey" FOREIGN KEY ("targetNodeId") REFERENCES "MemoryNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_sourceMnemonicEntryId_fkey" FOREIGN KEY ("sourceMnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryLink" ADD CONSTRAINT "MemoryLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemoryChain" ADD CONSTRAINT "MemoryChain_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemoryChainItem" ADD CONSTRAINT "MemoryChainItem_chainId_fkey" FOREIGN KEY ("chainId") REFERENCES "MemoryChain"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryChainItem" ADD CONSTRAINT "MemoryChainItem_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "MemoryNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bookmark" ADD CONSTRAINT "Bookmark_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewCard" ADD CONSTRAINT "ReviewCard_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewLog" ADD CONSTRAINT "ReviewLog_mnemonicEntryId_fkey" FOREIGN KEY ("mnemonicEntryId") REFERENCES "MnemonicEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
