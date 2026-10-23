## Fixed

- **判决面拿到的是原样路径**：git 输出含非 ASCII 字符的路径时，默认（`core.quotePath=true`，
  **git 的默认值**）按 C 风格转义并**加引号**（实测 `M\t"docs/standards/15-\351\231\204\345\275\225.md"`），
  于是改动面 / 暂存面里那一条与真实路径对不上 ⇒ 判据判成「没改」⇒ **恒绿**。
  本仓有 **38 份被跟踪文件的文件名带非 ASCII**（全在 `docs/` 下）⇒ 每次改文档面都撞上。

  ⚠️ **机器之间本来就有差别**，而差别恰好落在默认值那一侧：开发机全局配了
  `core.quotepath=false`（路径原样 ⇒ 该红的红），**CI runner 的 git 是全默认**
  （检出后只 local 配了身份与凭据，宿主**没有**全局 `.gitconfig`）⇒ 路径被转义 ⇒
  该红的**不红**。同一份代码，本机绿、平台红，而**平台的读数完全正常**
  （`[doc-mirror-pairing] OK：本次没有……`）。

  现场：PR #2270 的「受影响用例」在平台上红 1 条
  （`tests/check-doc-mirror-pairing.test.ts` 的「--base 形态：相对基线改了源、没带镜像 → 同样拦」），
  平台读数是「判决面：基线 HEAD~1，**1 个文件**」—— 改动面**取到了**，但那条路径认不出来。

  处置：

  1. 仓库里凡是读 git 路径的调用，一律带 `-c core.quotePath=false`（或 `-z` 那一族：
     NUL 分隔，git 不加引号）—— 共 14 处，含**改动面的唯一出处**
     （`scripts/changed-scope.mjs`）、**暂存面的唯一出处**
     （`scripts/gate-scan-read.cjs` 的 `readStagedPaths()`）、`affected-tests.mjs` 的
     暂存档与索引清单、`check-format.cjs` / `check-deps-freshness.mjs` /
     `check-docs-api.cjs` / `shell-gate.mjs` / `known-failed-selftest-gate.mjs` /
     `storybook-check.mjs` / `freshness-gate.mjs` / `check-commit-claims.mjs` /
     `ci-install-deps.mjs` / `merged-side-loss-git.mjs` /
     `launcher-core/runtime-heal.mjs` / `ship-preflight.mjs`。
     最坏的一处是**暂存面**：`skipUnlessStagedTouches()` 拿暂存清单与扫描根比对，
     路径被转义过就**跳过整条判据** ⇒ 判据在场却没跑。
  2. **判据不许依赖机器配置**：`tests/git-path-quoting.test.ts` 在**强制
     `core.quotePath=true`** 的环境里跑改动面与暂存面（复现靠配置，不靠「这台机器
     恰好配了什么」），并在 `tests/check-doc-mirror-pairing.test.ts` 里钉住「判决不因
     机器的 git 配置而变」。
  3. **防复发**：同一条用例里的静态判据 —— `scripts/**` 凡是读 git 路径的调用必须带
     守卫；豁免逐条登记（`EXEMPT`），且**处数对不上就红**。

  ⚠️ 这一族**仓库里已经踩过一次、修了一处、没传播**：`scripts/check-commit-claims.mjs`
  早就写着「`-c core.quotePath=false` 是**必须的**……名单**静默变成 0 份**」（实测 4 处假红），
  那一处修好了，改动面/暂存面那几处没有 ⇒ 同一个机制在别处继续生效。
