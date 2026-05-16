import type { LevelTag } from "@prisma/client";

export type VocabCategory = {
  tag: LevelTag;
  slug: string;
  label: string;
  shortLabel: string;
  description: string;
  href: string;
};

export const vocabCategories: VocabCategory[] = [
  {
    tag: "LEVEL_2",
    slug: "level-2",
    label: "二级",
    shortLabel: "二级",
    description: "义务教育英语课程标准 2022 二级词汇，主要对应小学阶段基础词汇。",
    href: "/levels/level-2"
  },
  {
    tag: "LEVEL_3",
    slug: "level-3",
    label: "三级",
    shortLabel: "三级",
    description: "义务教育英语课程标准 2022 三级词汇，主要对应初中阶段基础词汇。",
    href: "/levels/level-3"
  },
  {
    tag: "CET4",
    slug: "cet4",
    label: "四级",
    shortLabel: "四级",
    description: "全国大学英语四级考试大纲词汇，官方词表中未标星的基础层级。",
    href: "/levels/cet4"
  },
  {
    tag: "CET6",
    slug: "cet6",
    label: "六级",
    shortLabel: "六级",
    description: "全国大学英语六级考试大纲词汇，官方词表中用星号标出的六级层级。",
    href: "/levels/cet6"
  },
  {
    tag: "GAOKAO_3500",
    slug: "gaokao-3500",
    label: "高考3500",
    shortLabel: "高考3500",
    description: "高考英语考纲 3500 词范围，适合作为高中到高考的主线词库。",
    href: "/levels/gaokao-3500"
  }
];

export const vocabCategoryByTag = Object.fromEntries(vocabCategories.map((category) => [category.tag, category])) as Partial<
  Record<LevelTag, VocabCategory>
>;
