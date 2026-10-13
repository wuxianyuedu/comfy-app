## Fixed

- **pre-commit 的「端口推导跨语言一致性」不再把子进程超时报成内容红**（规范 §1.1 / §13.6.4.1，
  审查台账 R11-01）：`scripts/check-app-port-vectors.cjs` 此前把 Python 侧的 `ETIMEDOUT` 与
  「四侧推导真不一致」塞进同一个数组，于是标题那句在**纯超时**时也说得出嘴。实测栽过一次：
  一笔纯文档提交被它拦下并报「四语言端口推导一致性失败：- Python 侧自检失败：
  `spawnSync python3 ETIMEDOUT`」，而同一条判据钩子结束后**就地复跑退 0** —— 那不是内容红，是没拿到测量，
  而话术把人引向「去改四侧实现」。现在两类各走各的出口：超时进 `unverified`，标题改成
  「未能完成取证（拦下，但**不是**四侧不一致）」，并给出可执行出口（先隔离复跑，复跑仍只是超时形态
  就按 §13.6.4.1 处置）。同文件的命令探测也不再把这个形状糊成一个布尔：旧实现
  `try { … } catch { return false }` 会让「10 秒内没回答」读成「这台机器没有 Python」，
  那一侧于是既不参与比对也不报红（比报错误导得更久）；现在分 `ok` / `timeout` / `missing` 三态，
  超时同样进 `unverified` 点名。**判定没有放宽**：取证不到时仍然退 1 ——
  「未校验要不要放行」是另一个口径，留给这条线拍，回归用例把「仍然 exit 1」一起钉住。
  预算秒数改为跟着常量走（`PROBE_TIMEOUT_MS` / `PY_TIMEOUT_MS`），话术里不留会过期的硬编码。
  配 `tests/app-port-vectors-timeout-classification.test.ts`（超时形状两种落法、三态探测、
  两条出口的分线，以及「被 import 时不跑检查」那道 `require.main` 守卫）。
