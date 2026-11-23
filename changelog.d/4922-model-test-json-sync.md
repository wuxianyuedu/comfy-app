## Added

- 工坊「测试模型」的统一输入 ⇄ JSON 输入两栏内容**双向同步**（ISSUE #4922）：
  切到 JSON 时按当前生效值（含最常用档默认值、工作流默认值、历史重试预填）
  序列化成 `{ mode, inputs }` 载荷预填进文本框；切回统一输入时把 JSON 里认得的
  参数键解析落回表单，解析失败留在 JSON 栏并在反馈位报错、不丢用户输入。
  序列化与解析同走 `pickWorkshopInputValues` 一条白名单过滤（新增纯函数
  `serializeModelTestJson`），点「生成」的既有链路不变。
