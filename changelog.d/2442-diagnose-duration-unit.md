## Fixed

**`pnpm ship --diagnose` 念出的格子时长不再把毫秒当秒**（ISSUE #2442）。

- 当场读数（build `cnb-phl-1k5rscpsg`，同一次输出里两个读数并排）：
  `── 失败格：受影响用例（stage-9 · status=error · 930916s）` 与 `Finished, code: 1, duration: 15m 30s`。
  930916 ÷ 1000 = 930.9s = 15m31s —— 同一格、同一跑。那条读数的用途是判断「这格慢在哪、
  还是卡死了」，而 10.7 天会把人直接带去查睡眠/掐表，那里什么都没坏。
- 根因是**印出来的字面量**：`scripts/ci-build-readout.mjs` 那句 `` ` · ${detail.duration}s` ``。
  平台的 `duration` 是毫秒，同仓另一个消费者一直按毫秒用它（`ci-probe-lock-readout.mjs` 的
  `create + durationMs`）—— 两处对同一个字段各说各话，错的是显示这一处。
- 修法没有就地拼一个 `Math.floor(ms/1000)`：时长档位早有一份定义，只是不在这一层 ——
  `src/lib/comfyui/lifecycle-exit.ts` 的 `formatUptime` 里（`42s` / `2m17s` / `1h02m`）。
  按硬规则 24 把它**下沉到 `src/lib/time-format.ts`**（那份文件的头注自称「展示用时间格式化的
  唯一出口」，档位收口正是它存在的理由），命名 `formatDurationMs`；`formatUptime` 改为委托，
  「未知」那句话术留在 ComfyUI 侧（拿不到时长写 `0s` 会被读成「起来就死了」，那是另一件事）。
  脚本侧经 `../src/lib/time-format.ts` 直接 import（先例：`ci-cp936-exit.mjs` 取
  `executable-resolve.ts`；`check-import-alias.cjs` 的扫描面是 `src` + `e2e`，不含 `scripts`）。
- 判据：`src/lib/time-format.test.ts` 钉档位、补零（`1m00s` 不是 `1m0s`）、四舍五入与
  「拿不到返回 null 而不是 `0s`」；`tests/ci-build-readout.test.ts` 钉住那份当场读数
  （930916 ⇒ `· 15m31s`，且串里不出现 `930916`）。
  **旧用例里有一条把 bug 钉成了期望**：`expect(text).toContain("100418s")` —— 它是照实现
  写的而不是照意图写的，修的时候那一行会红，那正是它该有的反应；已改成 `· 1m40s` 并加反向断言。
