## Fixed

- **`pnpm run docs`（重生成 `docs/api/**`）不再把 typedoc 的退出码当结论**：它写出失败时照样**退 0**、日志照样收在 `[info] html generated at …` 上 —— 于是「**退出码 0** + 「html generated」+ 一条 `Found 0 errors and N warnings` + **产物一个没更新**」这四样会同时出现，而「这次到底跑没跑成」在当时没有任何一个环节在判，下一次发现它的时机是「有人翻 `docs/api` 看到它过期」。根因是 typedoc **失败后没重试、也没返回非零码**，不是它的清空能力有问题：目录里还堆着上一轮那 2539 个产物，所以「文件数 > 0」这类判据会被它蒙过去。
  - **现在按产物判**：探针文件 `index.html`（HTML 渲染器每一次必然重写）的 mtime 早于本次开始时刻 = 这一轮没写 ⇒ 判失败；**失败会重试**（默认 3 次、间隔 1s / 3s —— Windows 上目录里某个文件仍被占用是**瞬时**失败，等一等就过），全部尝试都失败才退非零，并带上 out 目录绝对路径、跑前 / 跑后的文件数与探针 mtime（「产物没更新」这种事没有这些数只能靠猜）。
  - 入口每次先把 `[INFO] typedoc out: <绝对路径>` 打出来：「它其实写到了另一个目录」是这类现场第一个该排除的可能。

## Added

- **`scripts/typedoc-run.mjs`**：typedoc「跑 + 验 + 重试」的**唯一实现**，`pnpm run docs` 与 `pnpm docs:check` 共用一份（判据脚本不再自己 `spawn` typedoc —— 自己起一份等于把「退出码不可信」这个坑再挖一遍）。带 `spawnImpl` 注入缝：typedoc 冷跑实测 31s，契约测试不可能真跑它。
- **`scripts/generate-api-docs.mjs`（= `pnpm run docs`，跨平台）**：支持 `--out` / `--attempts`；Windows 双击入口 `tools/docs/generate-api-docs.ps1`，已按 §9.5 登记进跨平台动作对照表与 `tools/README.md` / `tools/docs/README.md`。
- **`scripts/check-docs-api.cjs` 改用同一份跑+验**：此前若 typedoc 静默失败，重生成的临时目录是空的 ⇒ 仓库里的产物被**全报成「多余」（源已不再产出）**，照那条提示去修就是把 `docs/api` 删掉；现在这种情况直接停在这里，不拿空目录去做比对。

## Tests

- `tests/typedoc-run.test.ts`（10 条）：钉住「退出 0 但探针没被这一轮重写 = 失败」这条无声路径（夹具里先放一份**上一轮**的产物，证明「文件数 > 0」蒙得过去）；重试到用完次数 / 第二次才写出来算**成功**且报第 2 次 / `--attempts 1` 不重试 / typedoc 没装时一次都不跑；以及「目录存在但没有 `index.html`」这类「没写出来」的形态。

## Chore

- 文档同步：规范 13 §13.5.5.1 的「两个实现口径」补上第三条（按产物判 + 重试），规范 §9.5 跨平台动作对照表 + `tools/README.md` + `tools/docs/README.md` 登记这个新动作，`README.md` 常用脚本那行改掉会被 pnpm 内建命令抢走的 `pnpm docs`，AGENTS 的「快速排障」补上「按产物判」这一句。
