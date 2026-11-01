## Changed

- **oxlint `eslint/no-void` 清零**（ISSUE #2776 / #2923）：118 处命中（预设选项
  `allowAsStatement: true`——语句位 `void foo();` 本来就合法，中的全是**表达式位**）
  逐处回答「reject 去哪」，三类处置：
  - **110 处落台账禁用**：全部是事件处理器 / setTimeout 回调调 store/hook action
    （`onClick={() => void c.savePrefs()}` 族）——action 内部 `try + runAsyncAction`
    吞错并落 UI 状态（抽查 savePrefs / fetchSettings / controller.save 三族），
    `void` 保留为 fire-and-forget 标记，禁用措辞固定
    `oxlint-disable-next-line no-void -- reject 由 action 内部捕获`（oxlint 原生
    指令形态——`eslint-disable` 会被 eslint 判「未使用的禁用指令」红）。
  - **8 处 stories 的 `() => void 0`** → `() => undefined`（no-op 不需要 void，
    语义逐字等价）。
  - **~15 处箭头体改块体**：`onClick={() => void X()}` → `onClick={() => { void X(); }}`
    ——语句位合法、零语义变化，不用落台账；多行 JSX 元素里的属性位上下文
    oxlint 不认禁用注释，只有这条路过。
  规则按预设同款选项启用（`allowAsStatement: true`）。
