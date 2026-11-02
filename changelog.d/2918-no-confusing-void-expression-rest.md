## Changed

- oxlint `typescript/no-confusing-void-expression` 第 3 批（收尾批）：除 `src/lib/**`、`src/app/**`
  外全仓清零（1127 处 / 301 份，ISSUE #2918；姊妹规则 `eslint/no-void` 见 #2776/#2923，
  复扫 0 命中无回潮）。至此该规则全仓 0 命中。形态处置：

  - **箭头简写 → 块体（1119 处）**：`() => doThing()` 一律换 `() => { doThing(); }`。
    其中 26 处 span 落在「`&&` 短路」的右操作数上（`(next) => !next && onClose()` 一族），
    按第 2 批先例换 `if` 语句；`use-workflow-persistence` 的 `report` 三元（`satisfies
    ActionReport`，声明类型本来就是 `=> void`）换 if/else 块体。
  - **`return <void 调用>` → 先调用再 `return;`（3 处）**：`ui/sidebar` 的
    `toggleSidebar`（上下文类型 `() => void`，4 个调用点逐一核对均不读返回值）、
    `tests/e2e-fake-comfyui-endpoint.test.ts` 的 Promise executor，同第 1 批 `readPgid` 先例。
  - **`void` 运算符套 void 调用（5 处）**：`() => void onCopy()` 一族（LogRow /
    ModelTagManager / VideoStudio / ShotStudio / ErrorPanel）。被调签名均已是 `=> void`，
    `void` 是冗余标记——换块体内直接调用，并移除随之失效的 5 条
    `oxlint-disable-next-line no-void` 注释（同位置的 `void <Promise 调用>` 合法标记未动）。
  - 保留 disable：0 条。全部命中均为「返回值未被消费」，无「确实被消费」案例。

  验证：单规则复扫全仓 0 命中；`tsc --noEmit` 通过；eslint（301 份改动文件
  `--max-warnings 0`）通过；`oxfmt` 规范化；受影响用例 70 份全绿。
