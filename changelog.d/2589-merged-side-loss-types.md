## Fixed

- **脚本档清账批 16：`scripts/check-merged-side-loss.mjs` 9 格清零，账从 45 处 / 7 份降到
  36 处 / 6 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是 §13.6.5「删分支前只认 PR 的
  `is_merged`、整份退回要在合并前被看见」那条的执行体（合并安全闸）。9 格是三个函数形参、
  一处对象形参解构（`scan({ sha, baseline })` → `@param {{sha, baseline}}`）、
  一处元组数组、三处 `Map.get` / 下标读取。

  两处按既有口径写清了就够，但**第三处值得单列**：`hist.get(f)` 与 `candidates.get(f)`
  都在 `noUncheckedIndexedAccess` 下成了 `string[] | undefined`，两处各补一句
  「**键必在，`?? []` 是写给类型看的**」—— 而且这一次不是断言，是**读过的实现**：
  `merged-side-loss-git.mjs:118` 建表时就 `new Map(files.map((f) => [f, []]))`
  按请求清单逐份预置了空数组（当场读的那一行），所以「取不到」这个分支在生产端不存在。
  这一条与批 7 那处（`occurrences.get(raw) ?? []`，键是从同一份 map 的键里问出来的）
  是同一形：**兜底写在有生产端保证的地方，并指明保证在哪**，而不是把它当成一条错误处理。

  元组数组那一格是**第三次**撞上同一形（批 5 / 批 9 / 批 10 之后）：
  `for (const [ref, label] of [[sha, "待查提交"], [baseline, "基线提交"]])` 这个裸字面量
  被推成 `string[][]`，解构出来的两个元素各带 `| undefined`，于是每一处使用点都要重新判一次。
  收成 `Array<[string, string]>` 一处声明解决 —— 这条已经够常见，值得在后面单收一次口径
  （见批记录），而不是每份文件各解释一遍。

  凭据（两条都跑了，第二条是真造场景）：
  ① 它自己的两份用例串行 = **2 份文件 / 21 条全绿**
  （`tests/merged-side-loss-gate.test.ts` 9 条 + `tests/merged-side-loss-git.test.ts` 12 条）。
  其中被本次改动直接碰到的：
  组遍历那一圈（`⑨ 退回成「只在被并进来的那条线上出现过」的版本 → 仍要认出来`）
  走的就是 `scan()` 里那个元组与 `candidates` 表；
  ② `node --check` 通过、`pnpm exec eslint` 对该文件零输出；棘轮 `--update` 后复算 =
  面 215 / 存量 **36** / **6** 份（本批零残留新格 —— 中途把 `candidates` 指成
  `Map<string, string[]>` 之后，`historyShas` 那一处新冒 1 格 `TS2322`，同样按生产端保证收掉，
  没有登记成已知存量）。
