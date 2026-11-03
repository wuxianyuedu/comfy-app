## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 3：`src/server` 清零**
  （ISSUE #2776 / #2917）：24 份 98 处逐处判空值语义（无 fixer，全手工改写），
  覆盖 api 路由（series-generation / generate / run / task / workflow-list /
  workflow-local-roots / workflow-mutations / trpc）、workshop 流水线
  （orchestrator / comfyui / final-compose / llm / repository /
  draft-repository / production-bridge 及其用例）、film（orchestrator /
  compose-film）、agent（review / run-engine）、better-auth（origin-policy）、
  mcp（workshop-mcp）、lib（range-request / audit 用例）。
  可空布尔 → `=== true` / `!== true`；非空域字符串、ID、taskId、projectId 等 →
  `=== null` / `!== undefined` 显式比较，运行期可取空串的（外部入参、LLM 产出、
  data URL）一并带 `!== ""` 保持逐值等价；workshop 编排器的
  `!scriptMarkdown?.trim()` 卫语句展开为 `=== undefined || trim() === ""`
  （TS 按同一属性引用收窄，下游调用原样通过）；`unknown` 工作流模板
  （`settings.imageWorkflow` / `videoWorkflow`，JSON 里可能是 null）→
  `!== undefined && !== null` 显式双判，不走 `!= null`（本批 eqeqeq 台账 0 新增，
  沿用 llm.ts 既有 2 处）；compose-film 字幕标题的 `heading || prompt`
  （空串回落是既有语义）→ 显式三元并撤掉配套的
  `@typescript-eslint/prefer-nullish-coalescing` 禁用指令（`||` 已不在，禁用变未使用）。
  真正的「外部数据任意缺值形态防御性收口」（task 路由 execPayload）→ 落台账禁用
  1 处（oxlint 原生指令 + 理由，不用 eslint-disable：eslint 未启用该规则）。
  改写全部逐值等价；`src/server` oxlint 复验该规则 0 残留、`tsc --noEmit` 通过、
  同目录 30 份测试 414 用例全绿。
