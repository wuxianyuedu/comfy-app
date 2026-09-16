## Added

- **`src/lib/llm` 与 `src/lib/core` 的覆盖率爬坡（补测试，不改源码）**：`llm` 子域 31.7% → **56.7%**，门槛同步从 `30/30/30/25` 抬到 `55/55/55/50`（只升不降，见规范 §18.6）。新增 105 例，全部打在**判决面**上而非凑行数：
  - `llm/secrets`（曾 9.5/0/0）：AES-GCM 加解密往返、每次新 IV、篡改密文 / 篡改 tag / 字段不足 / 换密钥一律返回 `null` 而不抛错、密钥文件 `0600` 落盘、文件不可用时回落 `LLM_SECRET`、只读部署下进程内随机兜底。
  - `llm/video-task-util`（曾 0）：远端异步视频任务的轮询判决 —— 两候选地址逐个尝试、窗口耗尽返回 `null`（调用方据此报 pending）、单次失败 / 非 JSON / 4xx 都不终止轮询、**模型名里的路径穿越被清洗**、落盘失败（HTTP 非 2xx / 空文件 / 断网）一律静默返回 `null`。
  - `llm/prompts`（曾 13.5/0）：模型不听话时的兜底 —— 代码围栏与前言剥离、字段缺失补空串、字段值是对象 / 数组时序列化而非产出 `[object Object]`、越界景别回落 `medium`。
  - `llm/browser`（曾 2.1/0）：SSE **跨 chunk 半个 JSON 的拼帧**（网络 chunk 边界与 `\n` 无关，拼错就静默丢字）、坏帧跳过而不中断整条回答、非 2xx 必须抛错而非返回空串、`stream:false` 的一次性调用与探测接口的 `ok` 严格布尔判定。
  - `core/config`（曾 66.7/25）：环境三态互斥、端口与日志级别的合法 / 非法取值、URL fail-fast 且错误信息带字段名、默认值必须取自 `CONFIG_ENV_DEFAULTS` 与 `endpoints`（回环写 `127.0.0.1` 不写 `localhost`）。
- **`src/lib/llm/browser.ts` 3 处现存缺陷已由新用例钉住现状并另行回报**（本批**不改源码**，保证「补测试」与「改行为」分离）：SSE `error` 帧被静默吞掉（半截正文当成功返回）、末帧缺 `\n` 时整条丢弃、`core/config` 的 `REAPER_ENABLED=false` 因 `z.coerce.boolean()` 按 JS 真值解析而**无法关闭** reaper。
