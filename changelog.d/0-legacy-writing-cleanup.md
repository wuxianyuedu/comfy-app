## Changed

- **清理 5 处「过时写法」**（规范 14 反模式速查表 + launch-and-build §2.1.6 的「旧写法→现在的写法」口径），全部机械替换、不改行为：
  - **① Tailwind v3 任意透明度旧语法**（14-T1）：`WorkflowLibraryList.tsx` 的 `bg-info/[0.04]` → `bg-info/4`（v4 斜杠百分比）。
  - **② `any`**（14-Y1）：`tests/agent-film.test.ts` 的 `Record<string, any>` → `Record<string, unknown>`，并撤掉配套的 `eslint-disable no-explicit-any`。
  - **③ 首字符索引**（14-Y9）：`src/components/workshop/script-markdown-utils.ts` 的 `fenceMatch[1]!.charAt(0)` → `Array.from(x.trim())[0] ?? ""`（空串/emoji 代理对安全）。同批的 `src/lib/log/log-cli-json.ts` 两处**刻意不动**：该判据自带「日志面板约 2000 次/轮」的廉价契约（函数注释即写明「只看前缀与首字符，不做 JSON.parse」），且 `splitCliLogLine` 已对 payload 做 `trimStart()`、判的又只是 `{` / `[` 两个 BMP 字符 —— 换成 `Array.from` 在这里零语义收益，只是每轮多分配两千个整串长度的码点数组。
  - **④ 堆砌式 `eslint-disable`**（14-Y2）：移除 `CustomNodesSettings/parsing.ts` 与 `NodePreviewCard.tsx` 两处文件级 `/* eslint-disable prefer-nullish-coalescing */` 块禁用；逐行实证后，`parsing.ts` 的 `saved.contentHash || ""` 右侧为 `""`（`??` 与 `||` 行为一致）直接改 `??`；`NodePreviewCard.tsx` 的 `data?.displayName || fallbackName` 空串需回退到 fallbackName、刻意保留 `||`，改为单行 `eslint-disable-next-line -- 理由`。
- pnpm 调用类（launch-and-build §2.1.6）经门禁 `dev-launcher-toolchain-gate.test.ts` 复核已 0 真实命中；硬编码 hex 色值（14-T6）属大项，未纳入本次机械清理。

## 验证

| 项                              | 结果                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 5 个改动文件 `eslint`（零警告） | EXIT=0                                                                                                                    |
| `tsc --noEmit` 本次改动面       | 无新增错误；master 上 `task-list-wire-contract.test.ts` 的 `parseVideoRows` 未导出破坏已由 1f629434 找回，全量 `tsc` 已绿 |
| `pre-commit` 钩子               | 见下方说明                                                                                                                |
