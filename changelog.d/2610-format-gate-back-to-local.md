## Changed

- **格式判据回到本地：D0 判 + 本地修，平台侧只判**（ISSUE #2610，业主口径 2026-10-29）。
  `.githooks/pre-commit` 的 D0 增加一步 `node scripts/check-format.cjs --staged`
  （不命中扫描面 ⇒ ~30ms 并明说「跳过」；命中 ⇒ oxfmt 全量档，实测 2s 级），
  红了唯一的出口是 `pnpm exec oxfmt <它点名的那几个文件>` —— **只点本次改的文件**，
  全库 `--write` 会产出与本次改动无关的整文件重排（违 §13.7）。
  平台那一格（`.cnb.yml` 的 `oxfmt 格式`）**保留全量判定**，作 `--no-verify` 与
  平台侧 squash 合并（硬规则 6 那条不跑本地钩子的路）的第二层；判据本体仍是同一份脚本。
- **撤掉「自动修 + 委托回写」那整条**（ISSUE #2342 → #2362/#2365 的收尾）：删
  `scripts/ci-format-fixup.mjs` 与 `tests/ci-format-fixup.test.ts`、删 `.cnb.yml` 的
  `api_trigger_formatfix` 事件口 / `.format-fixup-delegate` / `.lock-formatfix`、
  摘 `scripts/ci-autofix-duties.mjs` 里 `oxfmt 格式` 那条登记。
  **撤它的理由不是那段代码写坏了，而是它的前提被实测否掉**：委托那一跳要 `start-build`，
  而 PR 事件的令牌只有 `repo-code:r` —— 2026-10-28 实测
  `403 / errcode 10023 · Missing required scopes: repo-cnb-trigger:rw`
  （build `cnb-tb0-1k61hpvhf` 的 `oxfmt 格式` 那格）。脚本按 fail-closed 退 1 并打全原文
  （它没有撒谎），但「就地修好」的产物每次都被丢在 CI 工作区里没人负责，
  而格式红照旧要人回来补一次 oxfmt —— 那一次 CI 往返什么也没买到。
  #2362 那句「`api_trigger` 是可信事件、令牌 rw」只对**被委托的那一条**成立，
  发起委托的那一跳仍挂在 PR 事件上，所以它从未真绕过那个限制（这是当年漏判的半句）。
- **同批把「谁会改写工作区」这件事翻成正面断言**：`AUTOFIX_DUTIES` 从此只剩
  「源 → 产物」那一档，`tests/ci-workspace-provenance.test.ts` 改为断言
  `src/` 与 `.storybook/` **不在**允许写名单里（谁把 autofix 请回来，这条会红）。
  `tests/doc-check-hook-wiring.test.ts` 五半同步反转：D0 必须有且带 `--staged`、
  且不许在别的组重复；平台侧必须是全量档、直接点 `check-format.cjs`、
  不许再出现 `--autofix` 或那个会写文件的壳；脚本头必须同时点名两个执行者
  （以前它要求头部**不许**写钩子 —— 同一条纪律的反向两半，随落点一起翻）。
- 规范同步：§13.5.1.1 改写为「执行者有两层」并把 #2010 → #2342 → #2610 三步历史与
  各自的依据留在原地（这三步反复验证的是同一件事：「谁在跑它」不写下来，
  「挪执行者」与「撤掉判据」在账面上长得一模一样）；§13.5.19 末段补 #2610 那次订正与
  三条口径（本体一份 / 平台不带 `--staged` / 请回 autofix 先要有能推出去的凭据 ——
  那是 ISSUE #2551 那件事）；§13.1 自查清单加上这一步；§13.5.25 那张成本表标注
  「该行现在记在 D0」；`docs/generated/` 镜像同批重生成。
