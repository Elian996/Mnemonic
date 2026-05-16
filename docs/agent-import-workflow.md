# 外部 AI Agent 导入工作流

mnemonic 当前推荐的导入方式是：外部 AI Agent 负责识别和结构化，网站只负责接收草稿、人工确认、保存入库。

## 流程

```text
截图 / 图片
  -> 外部 AI Agent
  -> 识别单词、音标、释义、划分、记忆方法、例句、相关词
  -> 裁剪截图里的嵌入图片
  -> POST /api/import/drafts
  -> 网站生成导入草稿
  -> 你在 /imports/[id] 修改和确认
  -> 保存到 Word / MnemonicEntry / MemoryLink
```

Agent 不直接覆盖正式数据。它只能创建 `ImportDraft`。正式保存必须在网站里确认。

## 直接使用内置外部 Agent 脚本

项目提供了一个独立脚本，不运行在网站内部：

```bash
export AI_AGENT_API_KEY="你的视觉模型 API Key"
export AI_AGENT_MODEL="gpt-4.1-mini"
export AI_AGENT_BASE_URL="https://api.openai.com/v1"
export MNEMONIC_SITE_URL="http://localhost:3000"

npm run agent:import-image -- /path/to/card.png
```

也可以只设置通用的 `OPENAI_API_KEY`；脚本会按 `AI_AGENT_API_KEY -> AI_AUTOFILL_API_KEY -> OPENAI_API_KEY` 的顺序读取。

如果你使用本地或第三方 OpenAI-compatible 视觉模型，把 `AI_AGENT_BASE_URL` 和 `AI_AGENT_MODEL` 改成对应值即可。

如果不想使用命令行，也可以打开网站内的 `/imports/new` 直接上传图片，生成的草稿同样会进入 `/imports`。

脚本会：

- 读取图片
- 调用视觉模型提取结构化卡片 JSON
- 要求模型返回内嵌图片 bbox
- 用本地 `sharp` 裁剪内嵌图片
- 调用 `POST /api/import/drafts`
- 输出草稿预览链接

## API

`POST /api/import/drafts`

```json
{
  "source": "my-image-agent",
  "word": "cylinder",
  "phonetic": "/ˈsɪlɪndə(r)/",
  "partOfSpeech": "n.",
  "meaningCn": "圆柱体；圆筒；气缸；泵（或筒）体",
  "shortMeaningCn": "圆柱体；气缸",
  "splitText": "cy | lin | der",
  "title": "cylinder 记忆卡片",
  "mnemonicMarkdown": "带你背\n\n通过 [[word:cycle]] 联想到圆形，通过 [[word:line]] 联想到直线。",
  "exampleSentence": "The car was powered by a four cylinder air-cooled engine.",
  "exampleTranslation": "这辆汽车是由一个四缸气冷式发动机驱动的。",
  "links": [
    { "type": "word", "value": "cycle" },
    { "type": "word", "value": "line" }
  ],
  "images": [
    {
      "kind": "embedded-illustration",
      "filename": "cylinder.png",
      "mimeType": "image/png",
      "base64": "iVBORw0KGgo..."
    }
  ],
  "rawText": "Agent OCR 原始文本"
}
```

返回：

```json
{
  "id": "draft_id",
  "status": "DRAFT",
  "previewUrl": "/imports/draft_id",
  "word": "cylinder"
}
```

打开 `previewUrl` 后可修改字段并确认保存。

## 图片

Agent 可以传：

- `url`: 已经可访问的图片地址。
- `base64`: 网站会保存到 `public/uploads/imports`，并自动写入 markdown。

嵌入图片请标记：

```json
{ "kind": "embedded-illustration" }
```

原始截图请标记：

```json
{ "kind": "original" }
```
