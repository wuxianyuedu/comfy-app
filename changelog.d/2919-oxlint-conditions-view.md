## Fixed

- **视图层 `no-unnecessary-condition` 清零（B1：`src/components/**` + `src/app/**`，205 处）**：
  这条规则此前不在 41 条零容忍集里，视图层累积了 205 处诊断（studio 子树占 160），
  它们分属四类形状 —— `??` 左值恒非空、多余可选链、字面量比较、恒真/恒假/类型无重叠。
  处置口径按形状分开，不追求「诊断归零」而追求「判据只留一套」：

  1. **左值恒非空（`??`）**：左值类型确实不可空 ⇒ 直接删兜底（如 `port ?? 4983`
     收敛为 `port`，端口来自服务端过程的必填字段）；
  2. **多余可选链**：先判值来源 —— 外部数据（tRPC/fetch 响应、Tauri IPC、localStorage
     读出的 `JSON.parse` 断言、ComfyUI 原始 `widgets_values`、持久化工作流 JSON）**保留 `?.`**，
     因为类型只到浅断言那一层、运行时旧数据仍可能缺字段；本地构造类型才删成 `.`；
  3. **恒真/恒假/字面量比较/类型无重叠**：**不删分支**，在该行上一行加
     `// oxlint-disable-next-line no-unnecessary-condition -- <理由>` 的台账注释（本仓
     `eqeqeq` / `no-void` 清零时用的同一形态），理由一句写明为什么必须留（外层守卫已收窄、
     事件值域比类型宽、卸载清理在 `await` 期间写入而控制流分析看不到，等）。
     配置层一个字没动（`oxlint.config.ts` / `eslint.config.js` / `.cnb.yml` 均未改），
     也没有新增任何其它规则的禁用。

  分六批落，每批只动与诊断直接相关的行：批 1 `ui`/`workshop`/`message-center`/`settings`（21），
  批 2 `src/app`（24），批 3 `studio/workflow-library`（36），批 4 `studio/workflow-editor`+`studio/canvas`（41），
  批 5 `studio/project-canvas`+`logs`+`history`+`workflow-form`（47），批 6 `studio` 根目录与 `hooks`/`comfyui`/`project-home`（36）。

  验证：`oxlint --type-aware src/components src/app` 该规则 **205 → 0** 且按规则分组无新增类别；
  新增台账 103 条，逐条带理由、全部只压本规则（结构性核验：103/103 含 ` -- `、103/103 规则名一致、0 条压其它规则）；
  全仓 `tsc --noEmit` 0 错；`eslint` 95 份改动文件 `--max-warnings 0` 通过；
  `check:oxlint-zero-rules`（41 条 × 2436 份文件）0 命中；`check-infra-file-size` OK；
  `vitest run src` 555 文件 / 6626 用例全绿（14 跳过为既有）。
