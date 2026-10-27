## Fixed

- **`scripts/ci-daily-build.mjs` 里两处死声明删掉（ISSUE #2524）**：`ARTIFACT_TIMEOUT_MS`
  被 import 而从未使用、`const HERE` 定义后从未使用。

  它们是怎么被看见的：#2503 新增的 `scripts/publish-desktop-bundle.mjs` import 了这份模块的
  `runContext`，于是它第一次进入 `tsc` 的 program —— 同一份 `pnpm exec tsc --noEmit`
  当场报出这两条（本机实测：把那两个新文件挪出工作区 ⇒ EXIT=0，加回 ⇒ EXIT=1，
  唯一变量就是那一条 import）。

  **本条只是把点名的两处删掉，不构成 #2524 的结案**：那一张要的是**范围**那一句口径
  （`tsconfig.json` 是 `allowJs` + `checkJs`，但对 `scripts/**` 的 `.mjs` 只判「被 import 到」
  的那几份 —— 一份没人 import 的脚本，类型检查与死代码判据都到不了它）。
