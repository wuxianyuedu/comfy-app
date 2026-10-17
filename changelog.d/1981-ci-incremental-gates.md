## Changed

- **平台侧流水线按扫描面增量：11 条「只扫某一处」的判据不再「没改到也重跑」**（ISSUE #1981 / 规范 §13.5.18）：
  用户问「CI 里的检查能否增量」，而平台侧此前**任何**改动都跑满全部 stage —— 改一行 README
  也要重跑「函数长度」「跨文件重复块」「ComfyUI 端口口径」这些**只扫 `src/**`** 的判据。
  本地钩子早就有这一层（`scripts/gate-scan-read.cjs` 的 `skipUnlessStagedTouches()`），
  而那条通道只在本地存在。现在用 stage 级 `ifModify`（官方语法手册 `#stage-ifmodify`，
  明确支持 PR 事件）把同一套扫描面接到平台侧。

  收窄 **11 条**：`标题行让位`、`import 别名统一`、`ComfyUI 端口口径`、`内联样式注入`、
  `跨文件重复块`、`函数长度 TS`、`函数长度 Rust`、`模块循环依赖`、`主题色扫描`、
  `跨平台动作对照`、`CHANGELOG 碎片`。**判据本身一字未改**（跑的还是同一份脚本的全量档），
  变的只是「这一步要不要执行」。

  **刻意不收窄的那几类**（收窄成任何子集都是漏判）：前提步骤（工具链自证 / Python /
  环境前提 / Install / 分支守卫 / 同步 DB）、全库级不变量（类型检查 / 文件结构 /
  UI 逻辑分离 / lib Node-only / 零消费导出 / core 三条 / 格式化提交分离）、
  文档面三条、`生产构建` / `浏览器安装` / `E2E 关键流程`。

  **「哪几条被收窄了」只有一处出处**：`scripts/ci-incremental-gates.mjs` 的
  `INCREMENTAL_GATES`（每条写着它守的是哪份脚本、为什么这条收窄安全），
  `tests/ci-incremental-gates.test.ts`（**进固定清单**，每次提交都跑）双向核对 ——
  登记表里每条 ⇒ 配置里逐字带着那组 `ifModify`；配置里带 `ifModify` 的 ⇒ 必须在登记表里；
  外加一条点名式的「必跑集合」不许出现在登记表里。少了后一半，有人可以直接在 YAML 里
  给一条全仓级判据挂上窄 glob、判据强度被削而没有任何信号。
  随手自查：`pnpm run check:ci-incremental`。
