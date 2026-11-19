## Fixed

- **宽兜底不再丢掉「这次改的那份用例」（ISSUE #2792）**：
  `scripts/affected-tests.mjs` 命中 `package.json` / lockfile / `vitest.config.ts` 这类
  公共地基时，原先直接 `return withFixed("all", [], …)` —— 固定清单全跑，但**这次
  改到的路径命中的用例一条都不并**。于是「碰一下 `package.json` + 新加/改过一份用例」
  的提交，那份用例在平台上一次都不跑，账面却是绿的。

  修法：兜底 = **扩大范围，不是替换**。wide 命中后判定链继续走，最后交给
  `withFixed("all", picked, wideNote)` —— 固定清单一条不跳，本次变更命中的用例照样并入。

  同批改：

  1. `wideFallbackNote(note, fixedCount, extraCount)` 的话术如实分开「固定清单 N 个 +
     本次变更命中的 M 个」，并写明「兜底是扩大范围、不是替换」；
  2. `gates-which.mjs` 的 `mode: all` 说明与 `scripts/affected-launch-full-run.mjs` 的
     注释同步改口径；
  3. 规范 §13.5.8 那一节与镜像同步；
  4. `tests/affected-tests.test.ts`：
     - 翻转原先「放弃收窄时不把受影响面塞进去」的断言（那是旧口径的执行者）；
     - 新增「碰 package.json + 新加一份用例 ⇒ 那份用例必须跑」；
     - wide 话术断言补「扩大范围」；
  5. `tests/hook-affected-launch.test.ts` 同步三参调用。

  实测证据（本机真实 CLI）：

  - `node scripts/affected-tests.mjs --changed package.json tests/affected-tests.test.ts`
    ⇒ `固定清单 107 个 + 本次变更命中的 34 个（合计 141）`，清单里含
    `tests/affected-tests.test.ts`；
  - 变异检验：把兜底临时退回「早退 + 空集」⇒ 新用例红（`expected [ …(107) ] to include
    'src/components/ui/newly-added.test.tsx'`，1 failed / 46 skipped）；恢复后 47 通过。
