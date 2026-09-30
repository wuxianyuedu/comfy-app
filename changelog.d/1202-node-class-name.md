## Fixed

- **执行中的「当前节点」终于有名字了**（ISSUE #1202，P3 §5 ADR §24）。`RunnerState.promptByTask` 的写方随 4-B3 删掉 `enqueue()` 一起消失，但它那两个读者一直在读它 —— 于是两格用户可见的东西长期退化：日志里永远是「▶ 节点 [3] 未知节点（?）」，而库里 `task.progressNode` 不带 `classType` / `label`（4-B2 之后状态栏「当前节点」读的就是 `classType`，画布读 `label`）。历史库里两条真跑成功的 raw 行，`progressNode` 都是 `NULL`。
  - 现在两个读者改读 `executedWorkflow` —— **提交那一刻真正交出去的那张图**（画布覆盖已注入、纯 UI 节点已剔除，所以与帧里的 id 对得上）。类名认得出两种形状：API 图的 `graph[id].class_type`，与 RAW（UI 原件）的 `nodes[].type`，含 comfy-cli 展开子图后的链式 id（`76:69`）。
  - **两条执行路径都接了，只接一条等于没修**：raw 任务的进度实际走 comfy-cli 的 stdout，不走 WebSocket —— 所以 `executor-cli-stream.ts` 里 `progress` 事件也补上了按图认类名，`executing` 那两行日志变成「▶ comfy-cli 节点 [76:69] 采样去噪（KSampler） 开始执行」。
  - 顺带把中文名表 `nodeLabel()` 从 `executor-ws.ts` 提到共享叶子（两条路共用一份；留两份就是规范 §12.12 的孪生对，而它的差别正好是「画布中文、状态栏类名」这种看得见的分叉）。

## Changed

- **issue 里那条「正解」的后半句没有照做，理由可核**：原文要求「删掉 `promptByTask` 与 `Job.prompt`」。`Job.prompt` 不是没主的字段 —— 它是 `executor-cli.ts` 非 RAW 那条分支的**入参**（`applyApiOverrides(prompt, overrides)` → 收拾图 → 直接提交），删它等于把 API 提交形态一起删掉，超出本单范围。字段留着，注释改成明写「当前两条入口都不带它，但那条分支消费它」。
- `RunnerState` 的单例键随字段增删升版（`comfyRunner_v2` → `v3`）：`globalThis.comfyRunner_vN ??= createEmptyState()` 只认键名，不升版号的话热重载后的旧单例形状与类型对不上。

## Docs

- ADR §13-3C（D1）与 §14（4-B2）里那句「comfy-cli 那条事件源拿不到 `class_type`」被真机原文推翻：**只对 `progress` 成立** —— `executing` 事件本来就带 `class_type` 与 `title`（而且是 ComfyUI 展开子图后的权威值，所以实现取「事件优先、图兜底」）。旧记录按当日理解留着，两处各加一句指向 §24；灰度指南 `docs/guide-executor-host.md` 那条「拿不到类名时为空」改成现状。
- 灰度指南里同批写明**仍然会为空的合法情形**：整轮被 ComfyUI 缓存（全是 `execution_cached`，一个 `progress` / `executing` 都没有）。这一类是另一条账（缓存轮次没有按节点可见性），已另开 ISSUE #1278，没混进这一刀。

## Tests

- 新增 12 条判据：`graph-node-class.test.ts` 4 条（两种形状 / 子图链 id / 载荷不可信一律不抛且认不出）、`executor-ws.test.ts` 5 条（raw 帧落库带 `classType` + 中文 `label`、API 形状同样带、认不出时两者都不带但**进度帧照落**、还没有图时也不丢帧、`executing` 记下的那一格用同一份图）、`executor-cli-stream.test.ts` 3 条（事件自带类名时以事件为准、不带时按图认、两者都认不出时只报 id）。
- **反向验过它会红**：把 `progress` 那侧的取值临时改回「恒空」（等价于修前行为），两条正向断言立刻红、三条负向仍绿 —— 不是自证的空壳。
- `src/lib/comfyui/` 全量 44 文件 / 603 用例绿；`tsc --noEmit --incremental false`（改的是被多处 import 的地基导出形状）、eslint、循环依赖 0 组、零消费导出 0、跨文件孪生 0 对。
- 真出图读数（副本库 + 独立宿主进程）：打掉 ComfyUI 执行缓存那一跑，`progressNode` 最终为 `{"id":"76:69","value":25,"max":25,"classType":"KSampler","label":"采样去噪"}`，面板同时出四行按节点日志。
