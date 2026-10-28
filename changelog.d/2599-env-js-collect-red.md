## Fixed

- **`pnpm build` 不再红在 collect page data**（ISSUE #2599，P1）。`src/env.js` 那段
  「缺 `.env` 时给一句人话」的预检用 `import.meta.dirname` 定位项目根，而那一位是
  **Node 的 ESM 运行时**属性 —— 本文件会被 Turbopack 重写，产物里 `import.meta` 只有
  一个合成的 `url` 取值器（实测读物 `.next/dev/server/chunks/src_env*.js` 里是
  `get url () { return __turbopack_context__.F("src/env.js") }`，没有 `dirname`），
  于是 `join(undefined, "..", ".env")` 抛 `ERR_INVALID_ARG_TYPE`，在
  **collect page data** 那一跳把整个构建打死。改回 `dirname(fileURLToPath(import.meta.url))`。
  **后果不止构建整档红**：`每日生产构建` 真失败 ⇒ `每日单元测试` / `每日全量E2E` /
  `每日 ESLint 零警告` / `每日浏览器安装` 四格 `skipped`（ISSUE #2114 那一族的新型态：
  红本身是真的，而四格根本没跑），产物级护栏（`check-standalone-contents` /
  `check-bundle-budget`）也随之一次都没执行过。
- **同批修掉第二格，它更阴**：`SKIP_ENV_VALIDATION` 的短路原先排在**路径计算之后**
  （写成「先 `join(...)`、只在用结果时看旗标」），于是两个显式声明「整段跳过校验」的
  执行者 —— `.cnb.yml` 的构建档与 `standalone-runtime-env.mjs` 的桌包运行期 ——
  **照样**在那一行上炸。现在短路排在任何 fs/path 动作之前（连 `await import("node:fs")`
  都不发生），表现不再是「我按你说的跳过了，却红在你没跳过的那一步」。
- 缺文件那句提示现在**带出探测的绝对路径**：真报出这一句时，第一样要看的证据就在
  同一行（§5「桌包启动即报 `MissingEnvFileError`」那一族的分诊入口）。
- 新增边界判据 `tests/env-import-meta-shape.test.ts`（**双向**钉）：`src/**` 非测试那一侧
  一个 `import.meta.dirname` / `filename` 都不许有；同时钉「`scripts/**` 那一侧仍在正当
  使用、判据不许扩过去」—— 那 141 处是纯 Node 宿主，`import.meta.dirname` 在那里真有值，
  改成全仓禁用会连带撤掉 `#2556` 那批的正当写法。这条读的是磁盘文本、不在 import 图里
  ⇒ 登记进 `scripts/fixed-structural-tests.mjs` 的固定清单，**每次提交都跑**：否则它的
  唯一执行者只剩每天那一跑，从落地到被看见要隔一次派发（这正是本单的成因）。
  变异验证：把那一位放回代码行 ⇒ 判据当场红并报 `src/env.js:30 · import.meta.dirname`。
- 规范同步：`launch-and-build.md` §9.2 第 6 条补这一族的两条口径（打包面只有 `url` 是活的
  + 旗标短路必须排在干活之前，含产物原文读数与 `scripts/**` 的边界语义）。
- **验证读数**：本地 `pnpm build` 现在过 collect（`Collecting page data using 15 workers`）
  并装配完 `.next/standalone`，`[standalone] ✓ 产物干净（共 3103 个文件）`。构建最后仍退 1，
  红在另一条**与本单无关**的判据上（`[static] 顶层出现白名单外的条目
  .cargo-test-placeholder` —— 壳的 `cargo test` 开发期占位落进了出厂件扫描面；
  当场反证：只挪开那个文件 ⇒ 两层全绿、退 0，放回来 ⇒ 又退 1）。已另立案 **#2629**。
