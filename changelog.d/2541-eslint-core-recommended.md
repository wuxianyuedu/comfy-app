## Fixed

**eslint 补齐 core recommended 面（#2541 第一批）：175 条存量清零，2 处真缺陷**（ISSUE #2541）。

### 症状与读数

本仓此前的「ESLint 零警告」是**空集意义上的 0**：`tseslint.configs.recommended`
不含 `eslint:recommended` 的 core 面，`no-control-regex` / `no-useless-escape` /
`no-useless-assignment` / `preserve-caught-error` 这批 core 规则从未跑过。
用 `@eslint/js` 的 recommended 面全量探测：**175 条 / 101 文件**。

### 配置（eslint.config.js）

- 引入 `js.configs.recommended`；顺序不能动——它必须在前，tseslint 接管的
  19 条 core 规则 + core `no-unused-vars` 的关停块在后（flat config 后者覆盖前者）。
- 作用面 = `LINT_FILES + scripts/**/*.{js,mjs,cjs}`（scripts 里修过的规则要继续有判据），
  两条例外关停并写明理由：`no-undef`（scripts 在 tsc checkJs 判决面里，core 版只出
  790 条 Node 全局噪音）、core `no-unused-vars`（scripts 68 条历史死代码，另立单子裁决）。
- `no-irregular-whitespace` 配 `skipComments + skipTemplates`：9 处现场逐条核实，
  5 处是注释里防 `*/` 提前闭合 / glob 拆写的刻意零宽空格，4 处是中文输出对齐的全角空格。
- `no-control-regex` 文件级豁免台账 12 个文件（正则本来就是匹配/剥离控制字符的功能，
  抽查 6/6 确认）。
- 随 `@eslint/js` 升级新增的 core 规则自动生效（跟上游对齐），出读数按同批流程裁决。

### 真缺陷（175 条里抽出的 2 处）

- `tests/design-md-contract-sync.test.ts` 的 `"\."` 是 no-op replace（应为 `"\\."`），
  且 `[^\d.]` 塌成 `[^d.]`——断言的转义从未生效；
- `src/lib/comfyui/status.test.ts` 测试数据 `"C:Comfy"` 缺反斜杠。

### 存量清理（机械 + 逐条裁决）

- `no-useless-escape` 33、`no-regex-spaces` 6（改 `{n}` 计数）、`no-empty-pattern` 4
  （vitest fixture 第一参必须是解构形态，空解构是 API 约束，逐处带台账的一行禁用；
  实测传 `_fixtures` 运行时 `FixtureParseError`）、`no-dupe-else-if` 1（删死分支）、
  `no-unexpected-multiline` 1、`no-unsafe-finally` 1；
- `no-useless-assignment` 82：codemod 去死初始化器（规则语义保证该值从未被读；
  RHS 有形态即人工核），含 4 处人工（`while ((m = re.exec(x))` 改条件直调、
  `let up` / `let last` 保类型标注去初始化器）；
- `preserve-caught-error` 20：全部补 `{ cause: e }`，无规则级豁免。

### 验证

全量 `eslint --max-warnings 0` 清零；`tsc --noEmit` 绿；`oxfmt --check` 绿；
针对性测试 30 文件 772 条通过（`tests/turbopack-tracing-excludes.test.ts` 的
3 条产物级探针红为本地陈旧 `.next/standalone` 所致——产物里有 402 个测试文件，
本 PR 不碰构建配置，CI 先测试后构建时该组自动跳过）。

### 边界（后续单子）

scripts 面 core `no-unused-vars` 的 68 条历史死代码、oxlint 作为第二道 CI gate
（unicorn 独有 5 条规则）的取舍，留在 #2541 后续批次。
