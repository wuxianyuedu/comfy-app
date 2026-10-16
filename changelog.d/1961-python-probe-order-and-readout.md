## Fixed

- **`Python 可用性` 从流水线末尾挪到「单元测试」之前，缺件不再只在最贵的位置才看得到**
  （ISSUE #1961）：那一步原先排在 **29 个 stage 之后**，而它前面是一条会跑到 2h24m 的
  `单元测试`。实测两跑（`cnb-jt3-1k5071kou` / `cnb-s61-1k50eo6p1`）都停在
  这一步之前的 `ESLint` 上、整机被压到**一步都推不动**，最终以
  `timeout of 8640000ms exceeded` 收场 —— 一条失败原因都读不到。

  这一步的位置此前是「E2E 之前」，理由（第一步那段的输出是成功即静默的）本身没错，
  错的是代价：缺解释器时**不会红**（相关用例按既有口径走 `env` 档跳过并登记），
  所以排在后面 = 这个结论要么永远看不到、要么在最贵的位置才看到。提到最前代价是几秒。

- **本仓解析器现在会真读着 `.cnb.yml` 的 `env`，把「这台机器上解释器在哪」打成可读读数**
  （同一 ISSUE）：新增 `scripts/python-probe.mjs`（逐个候选问「这个**命令**起不起得来」，
  与 `--python-only` 共用 `findPython` / `pythonForensics`，不造第二张候选表），
  由 `env.COMFYAPP_CI_PYTHON_PROBE` 点名、`.githooks/pre-commit` 的 C 组在跑结构守护用例
  之前打印一次（**只打印、不阻断** —— 开发机没装 Python 不该变成提交门槛）。
  缺件时那几条用例**照旧跳过、照旧不红**，变的是心里有数：跳过的是哪几条、因为什么。

## Added

- **`.cnb.yml` 的 stage 顺序不再只靠人核对**（同一 ISSUE）：`env.COMFYAPP_CI_GATES`
  登记有序的 stage 名，`tests/no-platform-ci-config.test.ts` 据此判
  「`Python 可用性` 必须排在 `单元测试` 之前」，并核对
  `COMFYAPP_CI_PYTHON_PROBE` 点名的入口真的在盘上（`env` 的值不经过 shell，
  写错了不会报任何错）。
