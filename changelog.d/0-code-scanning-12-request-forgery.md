## Fixed

**Code scanning #12（`js/request-forgery`，critical）：`getHistory` 的 `promptId` 按路径段编码**：

- 现场：`src/lib/comfyui/client.ts` 直接拼 `${comfyBase()}/api/history/${promptId}`；
  `promptId` 来自 ComfyUI / comfy-cli 回传的 `prompt_id`，裸拼时 `../`、`?` 能改写请求路径。
- 改法：`encodeURIComponent(promptId)`，与同文件 `getModels` 的 folder 同一口径；
  host 仍是用户配置的 ComfyUI 地址（本应用的用途，不是攻击面），收的是路径段。
- 用例：`client.test.ts` 钉住 `../../system_stats?x=1` 被编码，URL 里不再出现
  `../` 或 `?x=1`。
