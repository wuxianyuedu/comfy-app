## Changed

- oxlint `typescript/no-confusing-void-expression` 第 3 批：`src/server/**`、`src/instrumentation.ts`、
  `tests/**`、`e2e/**` 清零（35 处 / 25 份，ISSUE #2918）。

  形态与前两批一致（箭头简写 → 块体）。三处需要单独说明：

  - `src/server/api/routers/task.ts` 的 `fsPromises.rm(...).catch((error) => logger.warn(...))`
    换块体 —— `logger.warn` 返回 `void`，`catch` 的回调本来就只为副作用；
  - `src/instrumentation.ts` 两处 `await import(...).then((m) => m.startXxx())` 换块体
    （`startDispatchLoop` / `installStreamCapture` 都是 `=> void`）；
  - `tests/e2e-fake-comfyui-endpoint.test.ts` 的 `return resolve();` 改成 `resolve(); return;`
    （在 Promise executor 里，`return` 只为提前退出）。

  验证：单规则复扫上述目录 0 命中；`tsc`（两份 tsconfig）/ `eslint` / `oxfmt` 通过；
  改动面受影响用例 166 份绿 —— 另有 3 份（`ci-slot-apply` / `dev-handle` / `tauri-tools-cache`）
  在干净基线上**同样命中**，`node scripts/base-check.mjs` 的结论是 `baseline-red`，与本次改动无关。

- oxlint `typescript/no-confusing-void-expression` 第 4 批（收尾批）：`src/components/**`
  清零（1127 处 / 301 份，ISSUE #2918；姊妹规则 `eslint/no-void` 见 #2776/#2923，
  复扫 0 命中无回潮）。至此该规则全仓 0 命中。形态处置：

  - **箭头简写 → 块体（1119 处）**：`() => doThing()` 一律换 `() => { doThing(); }`。
    其中 26 处 span 落在「`&&` 短路」的右操作数上（`(next) => !next && onClose()` 一族），
    按第 2 批先例换 `if` 语句；`use-workflow-persistence` 的 `report` 三元（`satisfies
    ActionReport`，声明类型本来就是 `=> void`）换 if/else 块体。
  - **`return <void 调用>` → 先调用再 `return;`（2 处）**：`ui/sidebar` 的
    `toggleSidebar`（上下文类型 `() => void`，4 个调用点逐一核对均不读返回值）、
    `tests/e2e-fake-comfyui-endpoint.test.ts` 的 Promise executor（与第 3 批同一改法，
    合流时同改自动并轨）。
  - **`void` 运算符套 void 调用（5 处）**：`() => void onCopy()` 一族（LogRow /
    ModelTagManager / VideoStudio / ShotStudio / ErrorPanel）。被调签名均已是 `=> void`，
    `void` 是冗余标记——换块体内直接调用，并移除随之失效的 5 条
    `oxlint-disable-next-line no-void` 注释（同位置的 `void <Promise 调用>` 合法标记未动）。
  - 保留 disable：0 条。全部命中均为「返回值未被消费」，无「确实被消费」案例。
  - 连带修一处闸门联动：`VideoQueueModal.test.tsx` 的等待点按 §11.14.3 改
    `expect.poll`（块体化触发了「测试层 waitFor 边界」闸，等的是 mock 调用数，
    非 DOM、非假定时器窗口）。

  验证：单规则复扫全仓 0 命中；`tsc --noEmit` 通过；eslint（301 份改动文件
  `--max-warnings 0`）通过；`oxfmt` 规范化；受影响用例 70 份全绿。
