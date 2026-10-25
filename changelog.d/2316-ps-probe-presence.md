## Fixed

- **「这台机器上有没有 PowerShell」改由探测自己回答**：`tests/check-file-structure.test.ts`
  的 `Build-Guard.ps1` 那一组原来只认 `try { execFileSync(候选, ["-NoProfile", …]) } catch`，
  即「spawn 没抛异常 = 在场」。盘上存在同名但不是 PowerShell 的可执行文件时，它会 spawn
  得起来、却把 `-NoProfile` 当自己的参数以非零码退出 —— 这一格于是照跑，随后守卫脚本的
  `HITS=…` / `CODE=…` 一个都不出现，`toContain` 等满 `testTimeout: 20_000` 才抛超时，
  报错行指向「超时」而指不到真因（三条用例、三句 `Test timed out in 20000ms.`）。

  提取 `probeExecutable()` 作判据：起不来（`error` 非空）与起来了但退非零都算**不在场**，
  该组如实 skip；探不到时把每个候选的失败原因一次打出来（是没装、还是那个名字被别的东西
  占了）。同一文件里 `python` 那处同形同批收掉 —— 它只是本机没有同名冒牌文件才没暴露。

  口径与判据：合法跳过改由探测自己说话，不让一条判不了的用例以超时形态记成红。现场见 ISSUE #2316。
