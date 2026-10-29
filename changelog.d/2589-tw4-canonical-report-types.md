## Fixed

- **脚本档清账批 7：`scripts/tw4-canonical-report.mjs` 18 格清零，账从 188 处 / 16 份降到
  170 处 / 15 份（ISSUE #2589 / 规范 §13.5.14.1）**：这份是「Tailwind 类名的等价写法」那个
  硬闸的执行体（`--check` 判源文件候选须为 0）。18 格里 14 格是形参隐式 any、2 格是
  `current` 那个当字典用的 `{}`、1 格是 `matchAll` 下标取出的 `string | undefined`，
  剩一格 `TS7023` 与前几批都不同形 —— **生成器自推不出来**：

  `function* walk(dir)` 里 `yield* walk(full)` 递归引用自己，返回类型因此依赖它自己的
  推断结果，tsc 直接判「隐式 any 因为被自己的返回表达式引用」。这一格的修法只有写出
  `@returns {Generator<string>}`；递归本身是真的，不是可以顺手拆掉的写法。

  **`Hit` / `Suggestion` 两个 typedef 顺带量出一处「两次取值」**：`occurrences` 收成
  `Map<string, Hit[]>` 之后，原来那两行
  `occurrences.get(raw).filter(…)` / `occurrences.get(raw).length` 各点了一次 `.get()`，
  类型上是 `Hit[] | undefined`。改成**取一次存进 `all`**（`?? []`）—— 那个键必然在场
  （`canonical` 的键就是从这份 map 的键里问出来的），所以 `?? []` 不改变任何一次读数；
  但「必然」是我知道的，不是类型知道的，写第二遍 `.get()` 等于每加一个消费点就要 tsc
  重新信一次（这也是原代码在隐式 any 下从不报、清完反而报的那一族）。

  **本批是「补类型不是纯减法」这条的第三次现场**（前两次：批 1 的 4 格、批 6 的 5 格）：
  `--write` 那个循环里 `canonical.get(pieces[i])` 在 `pieces` 有了类型之后新冒一格
  `TS2345`（`string | undefined` 喂不进 `get(string)`）。循环界 `i < pieces.length`
  已保证有值 —— 按批 6 定下的口径处理：**取出到一个局部变量、加一句 `undefined` 守卫**，
  不抬严格度、不写非空断言，也不把这格 `--update` 登记成已知存量。

  行为恒等的凭据（两件各跑一遍，不靠「看起来没改到」）：
  ① 专供本判据的两份用例 `tests/tw4-hardgate-behaviour.test.ts` +
  `tests/tw4-canonical-ratchet.test.ts` 串行复跑 → **2 份文件 / 18 条全绿**
  （含「一条真候选即阻断」「注释里的示例不算候选」「`--update` 这个出口已不存在」三条）；
  ② 本脚本的四条出口各在仓库外的一份临时 `.tsx` 上走一遍：默认档报出 3 条建议、
  `--write` 真的把那 3 个类名换掉而 `text-[13px]` 原样保留（任意值仍不在等价判据里）、
  改写后 `--check` 退 0 说「源文件 0 处 ✓」、把内容还原后 `--check` 退 **1** 并逐文件
  念出「3 处」—— 也就是 `current` 那份 `Record<string, number>` 在 0 与非 0 两支都被读过。
