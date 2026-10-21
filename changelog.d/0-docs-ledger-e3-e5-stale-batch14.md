## Fixed

- **`PRODUCTION-GAPS.md` 自己就是这条线一直在抓的那两族缺陷的现场**（过时陈述 + 同一份文件里
  两段互相矛盾），一次扫出四处：
  - **E5 的标题与勾写着「余两格按名登记」/ `- [ ]`，而同页第 19 行已经写明那两格处置完了**，
    条目正文末尾也写着「本轮都已处置」（一格进 `RATCHETS` 后随 R5 一起翻硬闸退出本表、
    一格进 `RETIRED_RATCHETS` —— `HARD_GATE_RULES` 已覆盖全部 85 条，棘轮车道无成员）。
    复算：`tests/ratchet-update-guards.test.ts` 的 `PENDING` 现在是 `{}`，而它有一条判据
    **要求它为空**。标题与勾随之改成 `[x]`。
  - **E3″「80 条 spec（29 条 `@critical`）没有任何自动执行者」两半都过时**：体量以 Playwright
    自己的枚举为准（`pnpm exec playwright test --list` → **81 tests in 21 files**；
    `--grep=@critical` → **73 tests in 19 files** —— 比"标了 `@critical` 的用例数"多，
    因为标记也挂在 `describe` 上、会带进整组子用例；旧写的「29 条」与它不是同一个量
    （那是标记出现的条数，不是枚举出来的可跑用例数））；
    执行者那一格**不再为空** —— `.cnb.yml` 每日清单里的 `每日全量E2E` 跑的是
    **不带 `--grep` 的** `node scripts/e2e-run.mjs`（81 条全档），今天那次每日跑实测
    `1 failed / 80 passed`、本格 100.0s（红因与定性见
    `docs/audits/2026-10-21-timing-baseline-refs-volume.md` 立案 5；那一格此前零执行记录，
    是因为排在它前面的构建格一直红着）。勾改成 `[~]`：剩下的**只有真登录态**那一格
    （全靠 `stubBackend` / 种 `localStorage`，没有 `storageState`），它是内容决定。
  - **E6 里那句「真落点在 e2e（E3″ 现在连执行者都没有）」** 随上一条一起订正。
- **`11-测试与可观测性.md` 有一处跨章矛盾**：它写着「平台侧 `E2E 关键流程` 跑
  `e2e-run.mjs --grep=@critical`，**那句话今天仍然成立**」，而 13 §13.5.23 的「同日第二处」
  记的正是**同一批里这一格被撤出 PR 清单**。复算以配置为准：`COMFYAPP_CI_GATES` 里没有
  `E2E 关键流程`（那份名单也不往文档里抄）。改成「已经不成立」并指回 §13.5.23；
  顺带订正同一节里那句「80 条 spec 今天能不能全过」—— 条数不抄进正文，取法是
  `pnpm exec playwright test --list`。
- **`TESTING.md` 的「已经有自动化」清单里那格「29 条 `@critical` E2E」** 换成
  「平台每日那一跑的 `每日全量E2E`（跑全档、不带 `--grep`，条数同上以 `--list` 为准）」——
  那一格既是错的数（73 条被 `@critical` 覆盖）也是错的形状（现在跑的是全档）。
- 复算：`pnpm doc:check` 退 0、`doc:render --check` ✓（三份生成物与源同批）、
  Playwright 两次 `--list` 实跑取数（不是照抄台账），`grep -n` 定位「同日第二处」所在小节
  后**改写了指针**（第一版我写的 §13.5.3.9 是错的落点，按 `awk` 反查标题改到 §13.5.23）。
