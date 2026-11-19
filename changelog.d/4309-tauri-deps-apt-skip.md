## Changed

**pr-gate 的「装 Tauri Linux 系统依赖」改为只在真碰了壳输入时才跑（#4309）**

这一步过去无条件给每个 PR 装 12 个 apt 包。实测 15 次 pr-gate：8 次约 22~35s、
7 次被 apt 拖到 8~15 分钟、2 次撞死在 15 分钟步级超时上——慢的不是拉索引
（13.2MB 只要 3s），是 install 阶段 `-qq` 之下的整段静默（慢样本里 561s 一行
日志都没有）。

- 新增 `scripts/ci/ci-shell-face.mjs`：用与壳门禁**同一条链**（changed-scope 的
  `resolveBaseRef` → `changedFilesForBaseRef` → `reconcileSyntheticMergeFace`）和
  **同一个正则**（直接 import shell-gate 的 `SHELL_INPUT_RE`，不抄第二份）在
  workflow 层回答「这次碰没碰壳」；没碰 ⇒ 跳过 apt。任何读数拿不到都 fail-open
  （按要装处理）——这一步是省钱，不是闸。
- `apt-get install` 去 `-qq`（与 #4294 对 update 的处置同源），下载阶段显形；
  两条 apt 命令加 `DPkg::Lock::Timeout=120`，真撞上 dpkg 锁时 120s 内失败、
  落进既有的整体重试，不再无声干等。
- 用例钉住：workflow 的条件形状（`!= 'false'` 才算跳过）、判定脚本与判据同源、
  命中 / 不命中 / 改名 / 基线拿不到 / diff 失败 / GITHUB_OUTPUT 落笔。
- 新 step 按门格总账规则登记进 `GA_PR_INFRA_STEPS`（前提设施，不判红；#3662 的
  「GA 的 PR 侧跑了没人记」那一面）。
