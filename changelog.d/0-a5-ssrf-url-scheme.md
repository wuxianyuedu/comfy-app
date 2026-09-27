## Fixed

- **SSRF 协议白名单（A5）**：`llm.configSave` 的 `baseUrl` 与 `setting.comfyEmbeddable` 的 `base`/`hostOrigin` 输入层加 `^https?://` 校验（与 `trainerUrl` 同口径），挡掉 `file://`/`gopher://` 等非 http 协议；`comfy-embed.ts` 的 `probeComfyEmbeddable` 已有 `isHttpOrigin` 运行时防护，本次补齐输入层纵深防御。证据：`src/server/api/routers/llm.ts`、`src/server/api/routers/setting.ts`。
