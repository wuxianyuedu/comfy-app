## Changed

- **oxlint SAFETY 注释「同行形态」收尾清零**（ISSUE #2807，接 d727b84ff 已合入的那批）：
  上一批把 `anti-slop(require-safety-comment-for-type-assertion)` 判中的存量归零，本批把规则盲区里
  剩余的**同行形态**（`/* SAFETY: … */` 与代码同处一行——含「行首是注释、断言跟在后面」的形态）
  统一改成**注释独占一行、紧贴包含断言的语句之前**，共 **478 处 / 264 份**（严格口径：注释所在行
  除注释外还有代码即算同行）。改写用可复现脚本（TypeScript AST trivia-span 定位注释 +
  沿「断言 → 第一个 owner 语句」路径向上找最低的 line-anchored 落点；落点在 JSX children 区时
  继续向上，避免裸注释插成渲染文本），注释文本逐字保留、不动代码 token、不调顺序。
  两处机器落点越过 owner（注释进了 `if` 块、落点却在 `if` 上方，规则在 owner 处就停走查）由
  人工收进块内（json-viewer.tsx、lifecycle-exit.ts）；另有两处 `as const`（规则本就豁免）的
  三元分支注释被 oxfmt 重排成同行，人工并成一句提到语句上方（theme-token-consumers.spec.ts）。
  vitest.config.ts 补 1 处裸断言（`null as string | null`）的 SAFETY 注释——全仓唯一一处
  当前被规则判中而无注释的位置。coverage-targets-exist.test.ts 有 1 处落点把 SAFETY 注释
  插进了 `// eslint-disable-next-line` 与其目标行之间（指令注释失效），按「SAFETY 在上、
  disable 指令紧贴目标行」人工调序。
- 改写后由 oxfmt 统一过一遍改动文件：少数现场原本靠同行注释撑住的换行被 oxfmt 重排
  （缩进级联，代码 token 与顺序不变）。验证：该规则全仓 0 命中；严格口径复扫同行形态 0 处
  （独行 1999）；`tsc --noEmit` 绿；`eslint --max-warnings 0` 全量绿；§12.12 重复块闸 /
  §12.13 函数长度闸绿；改动涉及的 148 份 vitest 测试文件复跑 139 过 / 7 跳过 / 2 红——
  两红均与本次无关：storybook-message-center-sources.test.ts 那红在 HEAD 原样复现
  （d0d797017 把面板 `onClick={() => markRead(…)}` 改成块体，测试的字面量模式没跟上，
  属 #2918 尾巴），shell-gate.test.ts 那红是高负载下的 30s 超时（单跑绿）。
