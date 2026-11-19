## Fixed

- `pnpm check:all` 的 `test` 那一档**恒红一条**（#4014）：`tests/daily-tracks.test.ts` 的
  「默认档念的是『没判』」用 `coverageGate([])` 判「没有旗标也没有环境变量」那一格，
  而 `coverageGate(argv, env = process.env)` 的缺省就是 `process.env`，
  `quality-gate.mjs` 又恰好给这一档的子进程注入 `COMFY_COVERAGE_ENFORCE=1`（ISSUE #2669）——
  于是唯一会跑它的那个执行者里，`enforce` 读到的是 `true`、断言 `toBe(false)` 必红。
  修法是把那份环境显式给空（`coverageGate([], {})`）：这一格要判的是「默认档」，
  就该把「没有这个变量」写出来，而不是靠「跑它的进程恰好没设它」。
