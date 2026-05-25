# mnemonic

mnemonic 是一个面向中文学习者的英语单词助记网站。它不是 AI 自动生成助记内容的工具，而是一个类似 Obsidian / Notion / Wiki 的人工编辑系统：每个单词都有页面，编辑和用户可以撰写助记内容，并用 `[[wiki-link]]` 把单词、词根、前缀、后缀、记忆块、场景和桥接词连接成可浏览、可复习的记忆图谱。

## 技术栈

- Next.js 15 App Router + React + TypeScript strict mode
- Tailwind CSS + shadcn/ui 风格基础组件
- Prisma ORM + PostgreSQL
- 自定义 credentials auth + bcryptjs 密码哈希
- Zod、React Hook Form 预留兼容
- React Flow 图谱
- Vitest 单元测试
- Playwright 端到端测试
- Docker Compose 本地 PostgreSQL

## 安装

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` 会自动检查本地 PostgreSQL：如果 Docker Desktop 没有运行，会先打开 Docker Desktop，再启动 `docker compose` 里的 Postgres，执行已存在的 migration，并在空库时写入种子数据。

打开 [http://localhost:3001](http://localhost:3001)。

## 环境变量

```env
DATABASE_URL="postgresql://mnemonic:mnemonic@localhost:5432/mnemonic?schema=public"
SESSION_SECRET="replace-with-a-long-random-secret"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
OPENAI_API_KEY=""
MERRIAM_WEBSTER_LEARNERS_API_KEY=""
AI_AUTOFILL_API_KEY=""
AI_AUTOFILL_BASE_URL="https://api.openai.com/v1"
AI_AUTOFILL_MODEL="gpt-4.1-mini"
AI_AGENT_API_KEY=""
AI_AGENT_BASE_URL="https://api.openai.com/v1"
AI_AGENT_MODEL="gpt-4.1-mini"
```

自动填写的词典优先级：
1. `AI_AUTOFILL_*` / `OPENAI_API_KEY`，用于结构化补全；
2. `MERRIAM_WEBSTER_LEARNERS_API_KEY`，用于更权威的英英释义、音标和例句；
3. 免费在线词典与短词条翻译兜底。

不再建议全量导入未经校验的第三方词库。`dict:import` 只适合导入经过筛选的 CSV。

## 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run db:migrate   # 执行 Prisma migration
npm run db:seed      # 写入种子数据
npm run test         # Vitest 单元测试
npm run test:e2e     # Playwright 端到端测试
npm run dict:download # 下载 ECDICT 英汉词典，用于自动填写
npm run dict:import -- --limit=1000 # 从筛选后的 CSV 批量导入单词
npm run agent:import-image -- /path/to/card.png # 外部图片导入 Agent
```

## 种子账号

- `admin@example.com` / `password123` / ADMIN
- `editor@example.com` / `password123` / EDITOR
- `reviewer@example.com` / `password123` / REVIEWER
- `user@example.com` / `password123` / USER

## Wiki-link 语法

支持：

```markdown
[[philosophy]]
[[word:philosophy]]
[[root:soph]]
[[prefix:dis-]]
[[suffix:-ed]]
[[block:put]]
[[scene:把不同意见摆到桌面上]]
[[word:philosophy|哲学]]
[[root:soph|智慧]]
```

规则：

- 带命名空间时，命名空间决定 MemoryNode 类型。
- 不带命名空间时，系统先尝试解析为 Word；找不到单词则创建 BRIDGE 节点。
- `|` 后是展示别名，链接仍指向真实节点。
- 保存 MnemonicEntry 时，会删除该条目旧的 `WIKI_LINK`，重新解析内容、创建节点、创建 MemoryLink，并让单词页和节点页展示出链和反链。

## 角色

- ADMIN：完整权限，含用户管理和暂停用户。
- EDITOR：管理单词、官方助记、节点、词链。
- REVIEWER：审核用户公开投稿和处理举报。
- CONTRIBUTOR：可投稿公开助记、创建私有助记。
- USER：创建私有助记、收藏、点赞、举报、复习。

所有关键写操作都在服务端校验权限。

## CSV 导入格式

后台 `/admin/words` 支持 CSV 导入，列为：

```csv
word,phoneticUk,phoneticUs,partOfSpeech,meaningCn,meaningEn,shortMeaningCn,levelTags,frequencyRank,difficulty
```

说明：

- `word` 按单词 upsert。
- `levelTags` 使用 `|` 分隔，例如 `CET4|CET6`。
- 合法等级：`PRIMARY`, `MIDDLE_SCHOOL`, `HIGH_SCHOOL`, `CET4`, `CET6`, `POSTGRADUATE`, `IELTS`, `TOEFL`。
- 可勾选“仅试运行”验证数据，不写入数据库。
- 导入结果写入 `AuditLog`。

## 产品结构

- `src/lib/wiki-links`：wiki-link parser、renderer、node/link resolver。
- `src/lib/services`：单词、助记、审核、复习、节点、词链等业务服务。
- `src/lib/auth`：登录、注册、session、密码哈希。
- `src/lib/review`：SM-2-like 复习调度。
- `src/lib/ranking.ts`：公开用户助记排序评分。
- `src/app`：公开页面和后台页面。
- `prisma/schema.prisma`：完整 PostgreSQL schema 与枚举。
- `prisma/seed.ts`：用户、单词、节点、官方助记、词链、复习卡种子数据。

## 已包含的核心工作流

- 编辑创建单词并发布官方助记。
- 助记 Markdown 安全渲染与 wiki-link 点击跳转。
- 保存助记时自动解析链接、创建 MemoryNode、创建 MemoryLink、维护 backlinks。
- 用户创建私有助记、提交公开助记。
- 审核员通过、精选或拒绝公开助记。
- 公开助记点赞、收藏、举报和排名。
- 图谱页、节点页、词链页展示记忆网络。
- 用户加入复习并完成 SM-2-like 复习调度。
- 管理后台的单词、节点、词链、审核、举报、用户管理。
