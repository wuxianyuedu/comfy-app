## Fixed

- **`.next/standalone` 产物探针在「尚无产物」的检出上会让整份测试文件收集失败，CI 的 `Test` 步骤因此必挂（ISSUE #489）**。`tests/turbopack-tracing-excludes.test.ts` 的产物级探针本意是「没有产物就整组跳过」，但组内首行 `const files = listFiles(STANDALONE)` 与那个 `describe.skipIf` 一样在**收集期**执行——于是「产物不存在」从「应当跳过」变成了 `ENOENT: no such file or directory, scandir '<root>/.next/standalone'`，整份文件 0 个用例、1 个 Failed Suite。CI 的 `pnpm run test` 排在 `Build` 之前，产物必然不存在，所以**每次必挂**；而开发者本机因为 `.next` 恰好存在（跑过 `pnpm dev` / `pnpm build`）而全绿 —— 又是一个「本地绿、CI 红」的静默形态，「一个守卫反过来把被守卫的对象缺失变成失败」。修法：产物判据在收集期**先求值成常量**再传入 `describe.skipIf`，`listFiles` 只在该常量成立时调用；跳过的语义与 `scripts/check-standalone-contents.cjs`（产物缺失即跳过并返回 0）对齐。另加**守卫自身的可运行性**用例：断言 `listFiles` 的调用必须挂在「产物存在」判据之下（不得裸调）、跳过判据先求值成常量再传入 `describe.skipIf` —— 这个「守卫反过来把被守卫对象缺失变成失败」的写法改回去即红。

反向验证：干净克隆（无 `.next`）本组 12 passed / 4 skipped / **0 failed**（改前整份文件 0 用例 + `Failed Suites: ENOENT`），假造一个含 `src/leak.test.ts` + `changelog.d/0-leak.md` 的 `.next/standalone` 后「不含测试文件」「不含变更碎片」两条立即失败并点名文件；把 `listFiles` 改回裸调后新增的结构用例立即失败。
