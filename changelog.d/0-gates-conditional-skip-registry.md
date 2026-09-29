## Added

- **条件性 skip 现在必须登记：`tests/conditional-skip-registry.test.ts`**（登记进
  `scripts/affected-tests.mjs` 的固定守护清单，每次提交都跑）。`pnpm test` 报「全绿」时，
  尾巴上那串 `23 skipped` 是唯一线索，而它不说明**绿的是哪一种** —— 最典型的是产物档：
  `describe.skipIf(!standaloneExists)` 在没有 `.next/standalone` 的检出上整块不跑
  （`tests/turbopack-tracing-excludes.test.ts` 那组产物级探针就是这样，§11.13 里已经记过
  一次「同一条判据换台机器结论相反」）。这类「静默不跑」与 §11.7 说的不可信绿灯同病，
  只是藏在 skip 里而不是藏在配置里。
- 判据三条：① 扫描面里每一处条件 skip（`it/test/describe.skipIf(...)`、经别名定义的 skip、
  以及无条件 `it.skip(` / `describe.skip(`）都要落在登记表里且**数量对得上** —— 偷偷多一处
  没登记会红，登记了却把站点删掉也会红（后者是「登记表自己会烂」这一类，与失效的 mock
  目标同病）；② 每条登记必须写**档位**（`env` 缺工具 / `platform` 平台分叉 / `artifact`
  缺构建产物 / `manual` 人工挂起）与非空理由，档位决定「在谁的机器上这一条其实没跑」；
  ③ 产物档必须存在且理由里点名「要先 `pnpm build`」，报数口径因此可查而不是靠人记。
- 首版登记 8 项 / 24 个站点，全部来自实测：`tests/check-file-structure.test.ts`
  的 `!psExe` 6 处与 `!python` 4 处（缺工具）、`tests/cross-platform-launcher.test.ts`
  两个方向的平台分叉各 1 处、`tests/dev-launcher-toolchain-gate.test.ts` 经
  `needsPosixExec` 别名的 8 处、`src/lib/process/kill-process-tree.windows.test.ts` 2 处、
  以及产物档 `tests/standalone-runtime-completeness.test.ts` 与
  `tests/turbopack-tracing-excludes.test.ts` 各 1 个 `describe`。
- 扫描口径的边界写在文件头并各有一条复算用例钉住：只认**语句起始位置**的站点，所以断言里
  出现 `describe.skipIf(...)` 字符串（`turbopack-tracing-excludes.test.ts` 正拿它当被测文本）
  不会被算成站点；别名只认「同文件内 `const X = it.skipIf(...)` 之后以 `X(` 开头的行」。
  形状变了要一起改这里，而不是让它静默漏数。§11.13 那条 ⚠️ 补上指向本判据的一段。
