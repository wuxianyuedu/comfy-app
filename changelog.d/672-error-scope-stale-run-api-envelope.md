## Changed

- 按形态扫描又清出三件事的重复实现，各收成一处（ISSUE #672，规范 16
  §16.2.4.33 ~ §16.2.4.35），三条新判据 **P30 / P31 / P32** 一上来就是硬闸：
  - **「同一块错误条服务多个条目」**（`use-model-tags` / `use-training-studio` /
    `useStoryboardPlanner` 的逐镜头润色 / `CharacterDesigner` 的逐角色润色 4 处 → 0）：
    新增 `~/components/ui/use-item-errors` 的 `useItemErrors`。收口前这些
    **一屏多条目**的逻辑层写的是 `useState<string | null>` —— 「最近一次操作的
    草稿」：新增失败后去删另一条，错误条被同一块覆盖，而上一条那行已经不再标红
    （提示说的是哪一条，只能靠用户回忆）。出口把错误挂在**那一条**上
    （`errors.get(id)`），并把「无条目归属」那档留给整表级错误
    （`errors.get(null)`，如新增失败 / 列表刷新失败）；条目删掉后它挂着的错误
    随之消失（生命周期收敛，按内容比较 key）。
  - **「取数 effect 里的作废守卫」**（8 处 → 0）：新增 `~/lib/stale-run` 的
    `beginStaleRun`。收口前那段 `let cancelled = false` 样板在模型库、任务图集、
    历史面板、素材库、影片台、抽出模型选择、代码块、画布节点对账里各写一遍，
    三件事各判各的：作废的时机、读法（`if (cancelled) return` 与
    `if (!cancelled) setX(…)` 并存）、以及 **`finally` 里的读法** ——
    后一处最容易写错：A 轮的 `setLoading(false)` 不看守卫就会在 B 轮已开始后
    落地，把「正在加载」错报成「加载完了」（八处里两处干脆没有 loading 态，
    差别不是风格，是**有没有这个 bug**）。它表达的是**非失败状态**
    （「这一轮已作废」不该写界面，也不该报提示）—— 这正是 §16.2.4.30 里
    `use-history-panel` 那条 P27 豁免的成因。
  - **「服务端错误信封」**（12 处写法 / 6 个读法 → 各一处）：新增
    `~/lib/api-error` 的 `apiErrorDetail` / `apiErrorBody` / `readApiError` /
    `readJsonBody`。收口前 `src/app/api/**` 的十二处手拼
    `{ error: errorMessage(e, "…失败") }`（其中三处要连带回业务字段：
    `folders`/`items`、`hint: "comfyui-unreachable"`），而**读它们的客户端有
    六种写法** —— 三份**逐字相同**的读取函数、一份多认 `{error:{message}}`、
    一份认三种形态、一份在 `unknown` 上直接取值、一份自己 `as` 断言、
    还有一份**只认**结构化信封（服务端回 `{error: "…"}` 时被读成「请求失败」）。
    口径先定死：**纯错误**走 `~/server/lib/error-response` 的 `errorResponse`
    （规范 10 §10.9），**带业务字段的失败**走本出口；两侧的键名只有一处
    （`RESPONSE_ERROR_KEY`）。
- `check-ui-primitives.cjs` 新增三条硬闸判据（P30 / P31 / P32），
  `HOOKS_ALSO_SCANNED` 补上 P30 / P31（P30 的存量 19/21 在逻辑层）。
  三条判据都按**形态**取锚点、各配反面用例 —— 三条边界都是实测踩出来的：
  P30 不能取 `.map(`（状态更新助手 `prev.map(c => …)` 离 setter 很近，
  会把批量错误位误判成逐条）、P31 不能写死变量名、P32 只数
  `{ error: errorMessage(…) }` 会把本地对象字面量算上（要求同片段里有
  「构造响应体」的动作）。
- 三个新出口登记进 `DOMAIN_EXEMPT`（`stale-run` / `api-error` 是跨域顶层单例，
  与 `async-action` / `browser-storage` 同款）并同批进 `vitest.config.ts` 的
  `coverage.include` + `thresholds`（门槛取实测值）。
