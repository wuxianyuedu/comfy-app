## Fixed

- **每日那一格不再接缓存槽**（ISSUE #2081，红在 `每日生产构建`）：接槽把作业里的
  `node_modules` 整体接成**指向项目根之外**的 junction，而 Turbopack 对这一条有硬要求 ——
  `Symlink [project]/node_modules is invalid, it points out of the filesystem root`，
  13.8s 就死，连带 skip 掉 ESLint / 浏览器安装 / 全量E2E / 全量单测四格。
  - 两臂读数（同一台机、同一份 master，唯一变量就是那一行 env）：接槽命中 `13.8s` 但构建格当场死；
    不接槽 `每日安装依赖` 48.8s（暖）/ 216s（冷），构建格**过了 Turbopack**，跑到 121.3s 才红在
    另一件事上（ISSUE #2082）。⇒ 红归接槽，不归搬盘、也不归 `next build`。
  - 为什么不是另外两条出路：官方为「`node_modules` 是指向全局虚拟 store 的链」准备的
    `experimental.turbopackAdditionalRoots` **在本仓锁定的 Next 16.3.8 里不存在**（判法是在装出来的
    `node_modules/next/dist/server/config-shared.d.ts` 上 grep，不是查文档）；放宽 `turbopack.root`
    要罩住的是整块 `G:\`，官方自己写着「别放宽到家目录那样」；「让槽树以实目录进作业」与
    「每日不接槽」付同一笔钱（往工作区真写一遍）却多一条新机制。
    代价写在明处：**每天多付 ~35s，换回一个能构建的工作区** —— 槽是优化，不是前提。
  - 这条配置差别**没有**退化成「两边可以漂」：`tests/no-platform-ci-config.test.ts` 把它收成一条
    登记过的例外 `DAILY_ENV_ONLY_ON_PR`，钉的是「PR 那一侧必须正好置着一行 `COMFY_CI_SLOT: "1"`、
    每日那一侧一个字都不许出现（写 `"0"` 也算违规），其余各行仍逐字相同」。
    新用例 `PR-only env 例外不是空转` 逐个喂四种坏形状（每日补回开关 / 写成 `"0"` / PR 侧被摘掉 /
    同键写两遍），并要求现役形状**必须过** —— 恒红的判据与没有判据在账面上同形。
  - `scripts/ci-slot-apply.mjs` 头注那句「接过去是干净的」按事实收窄：它对 `tsc` / `vitest` 成立，
    对 `next build` 不成立。那句之所以从来没被推翻，是因为 PR 那条流水线 2026-10-18 起不跑构建
    （§13.5.23）—— 这条链的第一个会拒绝它的消费者，出现在每日档第一次接上槽的那天。
  - 顺带记档一条与它并列的前提缺口：夜里 04:00 那一跑（`cnb-oov-1k5decms4`）死于**这台机睡着了** ——
    `每日工具链自证` 的墙钟记到 10808.7s（≈3.0h）而同一格最后仍打「通过 ✓」。每日档那句
    「机器空着、没有并发 PR 时」漏的条件是**「醒着」**；读数与后果见
    `docs/audits/2026-10-21-timing-baseline-refs-volume.md` 立案 4。
