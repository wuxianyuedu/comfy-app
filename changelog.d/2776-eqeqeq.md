## Changed

- **oxlint `eslint/eqeqeq` 清零**（ISSUE #2776 / #2922）：160 处命中里
  **159 处是 `== null` / `!= null` 形态**（同时判 null 与 undefined——这正是该写法的
  全部意义，`===` 会漏 undefined 一半），逐处落台账禁用（固定措辞
  `oxlint-disable-next-line eqeqeq -- 同时判 null 与 undefined`；JSX 上下文用
  `{/* ... */}` 容器形态——裸 `//` 在 JSX 子元素里是**字面文本**，会渲染进 UI 且
  不被认作指令，实测踩过）。禁用走 **oxlint 原生指令**而不是 `eslint-disable`：
  eslint 没启用 eqeqeq，`eslint-disable` 会被它判「未使用的禁用指令」直接红
  （`--max-warnings 0`，实测 premerge 抓过）。唯一一处非 null 位
  （`uniqueErrors?.length == 1`）改 `=== 1`（number 对 number，行为等价）。
  此后 `== null` 的新增写法必须带台账禁用（用 oxlint 形态）。
