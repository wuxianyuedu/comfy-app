## Changed

- **B5 子批 13：20 份 / 43 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批集中在 `lib/agent`、`lib/comfy` + `lib/comfyui` 的响应解析，以及 `lib` 根的存储 / 事件 /
  设置读取与对应用例。
  修法仍是「运行时校验 + 类型守卫」：
  - `lib/agent`：`JSON.parse` 结果先置 `unknown` 再 `isRecord` 守卫；数组项改 `filter(isRecord)`；
    项目类型改白名单 `find` 收窄；`server` 的 `reply` / `action` 用 `typeof` 就地收窄。
  - `lib/comfy` / `lib/comfyui`：外部响应体逐层 `isRecord` / `Array.isArray` / `typeof` 判型，
    非法形状走各自既有回落（`{}` / `[]` / 离线默认值 / 抛错）；状态变更 `kind` 加白名单谓词；
    模型列表加 `isStringList`、设备列表加 `isComfyDevice`。
  - `lib` 根：`readStorageJson` 把 `JSON.parse` 变成 `parse` 的默认参数（不再需要断言）；
    应用事件读侧按 `AppEvents` 表逐条校验最小形状；`readApiError` 改 `Reflect.get`；
    设置文件只取 `DEFAULTS` 认识的键（顺带剥掉废弃的 `comfyuiUrl`）；
    测试侧 mock 改 `vi.fn<签名>()`、`Response` / `MessageEvent` 改真实构造。
- 语义未变：合法输入结果一致；非法输入维持各自既有的回落 / 抛错行为。
- 台账：B5 行改「清账中（子批1–13：260 份 / 526 处已清）」。

Refs #3181
