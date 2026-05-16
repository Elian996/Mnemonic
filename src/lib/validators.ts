import { LevelTag, MnemonicStatus, UserRole, WordStatus } from "@prisma/client";
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export const registerSchema = loginSchema.extend({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/),
  displayName: z.string().min(2).max(40)
});

export const wordSchema = z.object({
  id: z.string().optional(),
  word: z.string().min(1).max(80),
  slug: z.string().min(1).max(100).optional(),
  phoneticUk: z.string().optional(),
  phoneticUs: z.string().optional(),
  audioUkUrl: z.string().url().optional().or(z.literal("")),
  audioUsUrl: z.string().url().optional().or(z.literal("")),
  partOfSpeech: z.string().min(1),
  meaningCn: z.string().min(1),
  meaningEn: z.string().optional(),
  shortMeaningCn: z.string().min(1),
  exampleSentence: z.string().optional(),
  exampleTranslation: z.string().optional(),
  levelTags: z.array(z.nativeEnum(LevelTag)).default([]),
  frequencyRank: z.preprocess(
    (value) => (value === null || value === undefined || value === "" || value === 0 || value === "0" ? undefined : value),
    z.coerce.number().int().positive().optional()
  ),
  difficulty: z.coerce.number().int().min(1).max(5),
  status: z.nativeEnum(WordStatus)
});

export const mnemonicSchema = z.object({
  id: z.string().optional(),
  targetWordId: z.string().min(1),
  title: z.string().min(1).max(120),
  splitText: z.string().optional(),
  contentMarkdown: z.string().min(5),
  status: z.nativeEnum(MnemonicStatus).optional(),
  editorScore: z.coerce.number().int().min(0).max(10).default(0),
  isOfficialRecommended: z.coerce.boolean().default(false)
});

export const chainSchema = z.object({
  title: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]),
  nodeIds: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([])
});

export const userAdminSchema = z.object({
  userId: z.string(),
  role: z.nativeEnum(UserRole),
  status: z.enum(["ACTIVE", "SUSPENDED"])
});
