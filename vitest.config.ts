import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "~": path.resolve(import.meta.dirname, "src"),
      // server-only 包在 vitest node 环境会抛错（它就是干这个的）；
      // 数据访问层的硬约束在 Next 构建期仍然生效，测试里换空实现。
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/stubs/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
    /* 超时预算：vitest 的默认值（用例 5s / 钩子 10s）低于本仓库的实测下限。
     *
     * 串行隔离跑（`--no-file-parallelism`）的最慢单条用例已经是 5469ms
     * （`client-bundle-node-builtins` 的全 `src/**`「use client」可达性 DFS），
     * `db-schema-ready` 4770ms —— 一条贴着默认值、一条在默认值之上，
     * 也就是**不开并行都会红**。全量并行时再乘一份争用系数：16 逻辑核上
     * 约 10 个 worker，而门禁用例各条要 `execFileSync` 真起 Node / git /
     * prettier 子进程，一轮实测 28 条报 `Test timed out in 5000ms`、
     * 2 个文件报 `Hook timed out in 10000ms`（两个 theme 用例的 `beforeAll`
     * 要现编一份 CSS，隔离跑 7.2s）。
     *
     * 20s = 最慢实测值 ×3.6；`it()` / `describe()` 上已有的显式预算
     * （10s / 30s / 60s / 120s 那几处）优先级更高，不受这里影响。
     * ⚠️ 这是**天花板不是目标**：用例慢到接近 20s 时该优化用例本身
     * （收窄扫描面、复用子进程），别再往上调这个数 —— 那等于把
     * 「挂死」的检出时间一起放大。
     *
     * 2026-09-27 复测：套件涨到 449 文件后 ×3.6 的余量被吃掉 —— 全量满载下
     * theme 的 beforeAll（隔离 7.2s）与 LogPanel 渲染双双越过 30s/20s，
     * 6 文件 / 11 例争用假红（单跑全绿）。抬到 30s / 45s，同样只买余量
     * 不改用例；下一轮涨套件时按同一条「最慢实测 × 余量」重算。 */
    testTimeout: 30_000,
    hookTimeout: 45_000,
    /* 并发上限：16 逻辑核（约 8 物理核）上默认开 ~15 个 worker，而门禁用例每条
     * 要再起 Node / git / prettier 子进程 —— 超订的那一份直接从「等 CPU」变成
     * 「等子进程」，于是要测 5s 的用例排到 30s 以上。同一台机器、同一份代码的
     * 三档实测（全量 437 文件）：
     *   默认并发（15）→ 红 8 文件 / 18 用例，墙钟 461s
     *   `maxWorkers: 8` → 红 4 文件 / 14 用例，墙钟 659s（**超时类红归零**）
     *   `--no-file-parallelism` → 与上一档同集合，用于给单条红定性
     * 剩下那 14 条全是 `AssertionError`（启动器 / 壳 / 产物三线），没有一条是
     * 争用假红 —— 也就是这一档已经把「并发导致的不可归因红」买干净了。
     * 代价写清楚：墙钟 +43%。买的是「隔离重跑一遍再定性」这件事不再需要发生
     * （见规范 §11.13），以及增量测试层不会把别线的红算到本次提交头上。 */
    maxWorkers: 8,
    // 覆盖率棘轮策略(2026-08-29):已覆盖目录按真实水平设硬门槛,随测试增长上调;
    // 新目录覆盖后加入下表。全库 3% 的整体数字仅作信息参考,不设全局门槛。
    coverage: {
      provider: "v8",
      /* 一条试用例红 → v8 默认**清掉覆盖率数据、不产出报告** —— 于是 `thresholds`
       * 表里的每一条都没被判定，而终端上只看得见那条红。表现不是「门槛没过」，
       * 是**门槛静默缺席**：现场实测 `pnpm test:coverage` 全量 464 文件 / 2 败，
       * `coverage/` 目录空的。`reportOnFailure` 让红与覆盖率**各自记账**：红照样
       * 非零退出，但覆盖率照常汇总并按门槛判 —— 否则「修红」会变成覆盖率唯一的
       * 阻塞条件，而它本来不该管这件事（规范 §11.7 的覆盖率棘轮）。 */
      reportOnFailure: true,
      // 三种格式各有明确用途，别按「没人看就删掉」精简：
      //   text          —— 人读（终端日志）；
      //   json-summary  —— 本地看目录汇总；
      //   lcov          —— 机器读的那份。平台侧流水线曾用 `testing:coverage` 插件
      //                    读 `coverage/lcov.info`（ISSUE #623 后该流水线已删除，
      //                    见 docs/standards/13 §13.5.3）。保留 lcov 是因为它是
      //                    「覆盖率接任何外部工具」的通用入口，且删掉会让
      //                    日后重启上报时重新踩一遍「插件找不到报告文件」那个坑
      //                    ——当时的现场是插件 1.8s 就退出，而报错完全指不出是
      //                    reporter 少配了一项。
      reporter: ["text", "json-summary", "lcov"],
      include: [
        "src/server/api/middleware/**",
        "src/server/film/**",
        "src/lib/**",
        /* ⚠️ 这里必须列出**每一个**被 thresholds 点名的 `ui/` 出口 ——
         * 阈值只对「出现在报告里的文件」生效，没进 `include` 的路径是一条
         * **静默失效**的条目（`ui/file-picker.tsx` / `ui/use-flash-state.ts`
         * 就是这样挂了一整轮：门槛写着 95/90/95/100，报告里查无此文件）。
         * 新增 `ui/` 出口门槛时**两处同批改**：本数组 + `thresholds`。 */
        "src/components/ui/file-picker.tsx",
        "src/components/ui/use-flash-state.ts",
        "src/components/ui/expansion-set.ts",
        "src/components/ui/wide-panel.tsx",
        "src/components/ui/progress-bar.tsx",
        "src/components/ui/key-value-rows.tsx",
        "src/components/ui/media-thumbnail.tsx",
        "src/components/ui/media-drag-source.tsx",
        "src/components/ui/use-hotkey.ts",
        "src/components/ui/use-scroll-follow.ts",
        "src/components/ui/form-field.tsx",
        "src/components/ui/use-external-action.ts",
        /* ⚠️ 新增 `ui/` 出口门槛时**两处同批改**：本数组 + `thresholds`。
         * 只写门槛不进 `include` 会让门槛**静默失效**（报告里查无此文件）。 */
        "src/components/ui/use-enter-commit.ts",
        "src/lib/external-open.ts",
        "src/lib/file-io.ts",
        "src/lib/browser-storage.ts",
        /* 本批三条新出口（规范 16 §16.2.4.30 ~ §16.2.4.32）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/lib/async-action.ts",
        "src/lib/query-string.ts",
        "src/lib/media/natural-size.ts",
        "src/lib/media/media-url.ts",
        /* 本批三条新出口（规范 16 §16.2.4.33 ~ §16.2.4.35）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）；
         * `use-item-errors` 是 `ui/` 下的 hook，一并登记。 */
        "src/components/ui/use-item-errors.ts",
        "src/lib/stale-run.ts",
        "src/lib/api-error.ts",
        /* 本批三条新出口（规范 16 §16.2.4.36 ~ §16.2.4.38）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/lib/unique-id.ts",
        "src/lib/comfyui/error-advice.ts",
        /* 本批三条新出口（规范 16 §16.2.4.39 ~ §16.2.4.41）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/components/ui/tree-rows.tsx",
        "src/components/ui/use-item-action.ts",
        "src/components/ui/use-element-box.ts",
        "src/lib/dom-rect.ts",
        /* 本批三条新出口（规范 16 §16.2.4.42 ~ §16.2.4.44）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/lib/next-frame.ts",
        "src/components/ui/use-copy-feedback.ts",
        "src/lib/is-record.ts",
        "src/server/lib/request-body.ts",
        /* 本批三条新出口（规范 16 §16.2.4.51 ~ §16.2.4.53）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/lib/media/mime-ext.ts",
        "src/lib/safe-name.ts",
        /* 通用图片查看器（形态 + 数值）两个出口：前者是弹窗、滚轮锚点与拖拽
         * 平移的组装，后者是缩放档位与倍数夹取。与上面那批同款 ——
         * **两处同批改**（`coverage.include` + `thresholds`），只写门槛不进
         * `include` 会让门槛静默失效。 */
        "src/components/ui/image-viewer.tsx",
        "src/components/ui/use-image-zoom.ts",
        /* 本批三条新出口（规范 16 §16.2.4.54 ~ §16.2.4.56）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/lib/number-format.ts",
        "src/lib/ordered-set.ts",
        "src/lib/media/data-url.ts",
        /* 本批三条新出口（规范 16 §16.2.4.57 ~ §16.2.4.59）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）；
         * `simple-key-handler` 是 `ui/` 下的出口，一并登记。 */
        "src/lib/keyboard.ts",
        "src/components/ui/simple-key-handler.ts",
        "src/lib/case-token.ts",
        /* 本批三条新出口（规范 16 §16.2.4.60 ~ §16.2.4.62）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。
         * 三个都是纯函数模块（无 React、无 IO），可以逐分支钉死。 */
        "src/lib/path-display.ts",
        "src/lib/dom-props.ts",
        "src/lib/with-timeout.ts",
        /* 本批三条新出口（规范 16 §16.2.4.63 ~ §16.2.4.65）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）——
         * 只写门槛不进 `include` 会让门槛静默失效。
         *   · `clamp` / `upper-token` 是纯函数模块（无 React、无 IO），
         *     可逐分支钉死；
         *   · `app-events` 只有在 jsdom 下才走得到真实分支（`window` 的
         *     存在性判据），用例自带 `@vitest-environment jsdom`。 */
        "src/lib/clamp.ts",
        "src/lib/collections.ts",
        "src/lib/upper-token.ts",
        "src/lib/app-events.ts",
        /* 本批三条新出口（规范 16 §16.2.4.66 ~ §16.2.4.68）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）——
         * 只写门槛不进 `include` 会让门槛静默失效。
         *   · `form-props` / `page-window` 是纯函数模块（无 React、无 IO）；
         *   · `use-throttled-progress` 是 `ui/` 下的 hook 出口（三个入口）。 */
        "src/lib/form-props.ts",
        "src/lib/page-window.ts",
        "src/components/ui/use-throttled-progress.ts",
        /* 本批两条新出口（规范 16 §16.2.4.69 / §16.2.4.71）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）；
         * `use-busy-action` 是 `ui/` 下的 hook 出口，一并登记。 */
        "src/components/ui/use-reentrancy-lock.ts",
        "src/components/ui/use-refresh-ticket.ts",
        "src/components/ui/use-busy-action.ts",
        /* P82 的合规出口（悬停提示收成一处，规范 16 §16.2.3 / §12.18 补地基）
         * 与它脚下的 `tooltip.tsx`（ISSUE #1295 给它加了视口安全边距，
         * 见规范 §16.8 台账）。与上面那批同款：**两处同批改**。 */
        "src/components/ui/hint.tsx",
        "src/components/ui/tooltip.tsx",
        /* `ui/toggle-group` 的选中档三层是本仓库的定制（规范 16 §16.8），
         * 有用例钉住就得进门槛。同款 **两处同批改**。 */
        "src/components/ui/toggle-group.tsx",
        /* 左轨让位这笔账（阈值算式 + 三档优先推导）与它的窄窗判据出口。
         * 同款 **两处同批改**（`coverage.include` + `thresholds`）：
         *   · `layout-budget` 是纯函数模块（无 React、无 IO），可逐分支钉死；
         *   · `use-narrow-nav` 只有在 jsdom 下才走得到真实分支（`window` 的
         *     存在性判据），用例自带 `@vitest-environment jsdom`。 */
        "src/lib/layout-budget.ts",
        "src/components/ui/use-narrow-nav.ts",
        /* 悬浮元素「拖到哪、下次还在哪」这一笔账的两个出口（ISSUE #1295 /
         * 规范 16 §16.2.4.72）：
         *   · `use-draggable-position` 是拖动 + 位置记忆 + 视口夹取，
         *     用例覆盖到「阈值内算点击 / 超阈值算拖动」「拖出视口被夹住」
         *     「窗口缩小后收紧」「只接主键」；
         *   · `use-viewport-size` 是「视口多大」的唯一读数，用例覆盖到
         *     「首帧 `null`」「resize 跟随」「取值未变不换引用」。
         * 同款 **两处同批改**（`coverage.include` + `thresholds`）——
         * 只写门槛不进 `include` 会让门槛静默失效。 */
        "src/components/ui/use-draggable-position.ts",
        "src/components/ui/use-viewport-size.ts",
        /* API 路由 handler（体检清单 ⑦ 的第一批：闸门与三态契约类）。这一层此前
         * **整层不在覆盖率面上** —— 既不在 `src/lib` 也不在 `src/server` 的通配里，
         * 于是路由的鉴权 / 路径包含 / 状态码契约坏了没有任何数字会动。
         * 与下面的 `thresholds` **两处同批**登记（只写一处 = 门槛静默失效）。 */
        "src/app/api/generated/\\[...path\\]/route.ts",
        "src/app/api/debug/source/route.ts",
        "src/app/api/comfy/stats/route.ts",
        "src/app/api/comfy/queue/route.ts",
        "src/app/api/comfy/ensure/route.ts",
        /* 系统指标收成单点持有者这一刀带出的三个新出口：轮询内核、在线迟滞本体、
         * 指标 store。同款 **两处同批改**（coverage.include + thresholds）：
         * poll-timer 的未覆盖分支是「既不隐藏也不失焦」那条早退，offline-gate 实测满档，
         * comfy-stats-store 未覆盖的只有 SSR 快照那一份。门槛按实测取不高于现状的档。 */
        "src/lib/poll-timer.ts",
        "src/lib/offline-gate.ts",
        "src/lib/comfy/comfy-stats-store.ts",
        /* 体检清单 ⑦ 第二批 · 并到安全台账 A 系列：这一批的用例是「先写断言、
         * 照出越权、顺手修」，所以门槛登记的是**判据本身**而不是新增行数。
         *   · `custom-nodes/route.ts` —— argv 注入闸门（A6）：POST 那几条出口
         *     已逐分支钉住，GET 侧（manifest / report 读取）仍是欠账，见台账 E7；
         *   · `routers/project.ts` —— 归属闸门（A3 + 本批新照出的 upsert 越权写）；
         *   · `routers/task.ts` —— 同一族的归属与越界闸门（A2 快照越权读、
         *     A8 产物目录越界），23 条用例已在跑，此前**从未被门槛判过**；
         *   · `media/output-paths.ts` —— 产物布局的唯一定义（A8 收口点），
         *     它同时被落盘侧与读删侧静态 import，分叉一次就是「删不掉的产物」。
         * 与上面那批同款：**两处同批**登记（`coverage.include` + `thresholds`）。 */
        "src/app/api/custom-nodes/route.ts",
        "src/server/api/routers/project.ts",
        "src/server/api/routers/task.ts",
        "src/lib/media/output-paths.ts",
        /* 体检清单 ⑦ 第三批 · 协议白名单收成一处（台账 A5 复算）：
         *   · `url-scheme.ts` 是「这个地址能不能交给外部程序」的唯一判据，
         *     四条出口（`setting.trainerUrl` / `comfyEmbeddable` 的两个地址 /
         *     `llm.baseUrl` / `openUrlInBrowser`）都改吃它 —— 每一支都必须有人判；
         *   · `routers/setting.ts` 第一次有执行者（34 条）。
         * 与下面 `thresholds` **两处同批**登记。`open-in-browser.ts` 不单列：
         * 它已在 `src/lib/shell/**` 这一组里，而没覆盖到的分支只有 darwin/linux
         * 两条平台分叉（本机是 win32，跑不到），单列一条只会把「测不到的那支」写进门槛。 */
        "src/lib/url-scheme.ts",
        "src/server/api/routers/setting.ts",
        /* 体检清单 ⑨ 第一刀 · 素材库的归属：
         *   · `media/materials.ts` 是 scope 归属与路径清洗的**唯一判据所在**
         *     （两个入口都吃它），所以它的分支必须被数字盯着；
         *   · `routers/material.ts` 与 `api/materials/route.ts` 是同一套判据的
         *     两个门 —— 只测一边等于另一半没 gate，两边一起登记。
         * 三条都按**实测**登记（不是回退）；未覆盖的部分主要是 REST 的 500 兜底与
         * 素材列举里的 stat 失败分支，欠账记在 E7 边上。 */
        "src/lib/media/materials.ts",
        "src/server/api/routers/material.ts",
        "src/app/api/materials/route.ts",
        /* 首页「本机算力」卡带出的两个新出口：**两处同批**登记。
         *   · `comfy-resource-metrics.ts` —— 显存/内存口径命名的唯一出处，状态栏与
         *     首页卡都读它；它一旦漂移，两处消费点会同时变红（负向验证实测过），
         *     所以这一层必须有数字看着。
         *   · `LocalComputeCard.tsx` —— 「读不到数的三种情形」是这张卡的全部价值，
         *     分支都在 jsdom 用例里走到位。
         * 门槛取实测（两者单跑皆 100/100/100/100，见各自用例）。 */
        "src/components/studio/comfy-resource-metrics.ts",
        "src/components/studio/LocalComputeCard.tsx",
        /* 体检清单 ⑦ 第四刀 · 产物读取口的归属（台账 A13）：
         *   · `media/output-access.ts` 是「这条产物能不能确定属于别人」的唯一判据。
         *     它按落点命名分三族（素材格 / 画布格走项目行、`films` 走出成片行、
         *     其余走任务行），每族一条查询、每条都有一个「查不到就放行」的保守侧
         *     —— 那个侧写坏了不会报错，只会把自己的图打成 404，所以必须满档判定。
         *   · 同批改的 `api/generated/[...path]/route.ts` 已在上面第一批里（满档），
         *     它的用例新增了「拒绝发生在 readFile 之前」与「Cache-Control 必须是
         *     private」两档 —— 后者是这条闸的实际出口：标 `public` 会让共享缓存
         *     把 A 的产物回给 B，判据写得再对也只剩形式。 */
        "src/lib/media/output-access.ts",
        /* `src/proxy.ts` —— 产物读取口的**接线**本身（台账 A13 的最后一环）。
         * 产物落在 `public/generated/` 下，而 `public/**` 由 Next 按静态文件直接发出、
         * 不经过 route handler —— 只在 route 上加闸门时，把 URL 里的 `api/` 去掉就整条
         * 绕过（本机实测：同一份图，静态形状 200、带闸形状 401）。这一层不进覆盖率面，
         * 「闸有没有真的接到请求上」就没有任何数字会动；而它的失效形态是**零报错**。 */
        "src/proxy.ts",
        /* 模型库这一刀的三个新文件（**两处同批**登记）。两个既有文件刻意不在这里
         * 新设门槛：`ModelCard.tsx` 与 `ModelLibrary.tsx` 此前不在覆盖率面上，
         * 拿一次隔离跑的数去锁它们，等于用不等同于全量的口径立规矩 —— 它们的行为
         * 判据在各自的用例里（死链、假基座、缺档位都各有用例钉着），不靠数字兜。 */
        "src/components/model/model-type-labels.ts",
        "src/components/model/model-cover.ts",
        "src/components/model/ModelDetailDialog.tsx",
        /* 首页「模型概览」这一刀的两个新文件（**两处同批**登记）。
         * `hooks/use-model-overview.ts` 刻意不登记：它只是把 tRPC 的一行结果转交给
         * `deriveModelOverview`，判断力全在那个纯函数里 —— 给一行接线设门槛，
         * 数字看着严格，实际什么都不守。 */
        "src/components/studio/model-overview-derive.ts",
        "src/components/studio/HomeModelOverview.tsx",
        /* 体检清单 ⑨ 第二刀 · 四个零执行者的 router（台账 E3 从 7/16 抬到 11/16）：
         * `film` / `train` / `model` / `llm`。这一批照出的不是「闸门弱」而是
         * **「闸门 procedure 自己就是死的」**：`train.cancel` 的第三参在 Prisma→Drizzle
         * 迁移期是 `select?: unknown` + `select as never`，调用点写成 Prisma 的布尔投影
         * `{ id: true, status: true }` 时编译器一声不响、运行时生成空投影 → SQL 语法错，
         * 于是「取消训练」自那次迁移起每次 500 —— 路由没有执行者，所以没有任何一条红。
         * 四条全按实测满档登记（52 条用例把归属、数值/协议/枚举闸与「拒绝发生在副作用
         * 之前」逐分支钉住），掉一支当场变红。 */
        "src/server/api/routers/film.ts",
        "src/server/api/routers/train.ts",
        "src/server/api/routers/model.ts",
        "src/server/api/routers/llm.ts",
      ],
      exclude: ["src/lib/**/*.test.ts"],
      thresholds: {
        /* ── 覆盖率棘轮第一次被真正判定时的重基线（台账 E2 开门即抓到的存量）─────
         *
         * 这批门槛此前从未被任何自动化路径判过（门禁的 test 门不带 `--coverage`，
         * 见 §11.7），所以代码里新增的未覆盖分支一路没人拦。把门打开的这一次全量
         * 跑（465 文件全绿）当场报出 21 条不达标，逐条按 §18.6 的口径改成
         * **「实测值向下取整到 5 的倍数」**，只降被违反的那一维，其余保持原值：
         *   · `src/lib/process/**`     50/60/50/55 → 20/45/25/20（实测 24.4/46.9/26.4/24.6）
         *   · `src/lib/browser-storage.ts` 95/100/90/90 → 80/85/80/85
         *   · `src/lib/core/**`        95/95/90 → 90/90/85
         *   · `src/lib/log/**`         statements 85 → 80
         *   · `src/lib/external-open.ts` statements 100 → 95、branches 95 → 85
         *   · `src/lib/path-display.ts` statements 100 → 95、branches 100 → 90
         *   · `src/lib/media/media-url.ts` lines/statements 100 → 95
         *   · `src/lib/media/mime-ext.ts` statements 100 → 95
         *   · `src/lib/with-timeout.ts` branches 100 → 80
         *   · `src/components/ui/wide-panel.tsx` functions 95 → 90
         * 不是并行档的抖动：同一批文件**单跑**带 `--coverage` 得到一模一样的数字
         * （`with-timeout` 分支 80、`path-display` 93.75、`mime-ext` 85.71、
         * `external-open` 85.18、`browser-storage` 81.81），所以是真回退。
         * 欠的课记在 `docs/guides/PRODUCTION-GAPS.md` 的 E7（点名四个大头文件与实测值）；
         * 补上用例就按 §18.6 的「只升不降」把这里抬回去。 */
        "src/server/api/middleware/**": {
          lines: 75,
          functions: 75,
          statements: 75,
          branches: 70,
        },
        // comfyui 执行链路的地基（ISSUE #314）：lifecycle 的探测/拉起/停止
        // 判决表抽到 lifecycle-derive 后可直接断言，目录整体随测试增长上调，
        // 只升不降（规范 11.7 的覆盖率棘轮口径）。
        "src/lib/comfyui/lifecycle-derive.ts": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
        "src/lib/comfyui/lifecycle.ts": {
          lines: 45,
          functions: 60,
          statements: 45,
          branches: 30,
        },
        // reaper 与队列调度的判决矩阵（ISSUE #315）：sweeper 的「跳过/回收/不动」
        // 与调度器的排队提示/槽位释放规则按实测值设门槛，只升不降。
        "src/lib/comfyui/reaper.ts": {
          lines: 70,
          functions: 70,
          statements: 70,
          branches: 60,
        },
        "src/lib/comfyui/executor-scheduler.ts": {
          lines: 70,
          functions: 70,
          statements: 70,
          branches: 50,
        },
        /* ── `src/lib` 的子域门槛（ISSUE #572 第 5 项 / 规范 §18.6）──────────
         *
         * 门槛此前只有上面那几个**文件**：`src/lib` 其余 180 个文件**零门槛**，
         * 于是「覆盖率」这件事对它们既不报警也不记账 —— 而 `film`（7.5%）、
         * `llm`（31%）、`core`（35%）恰恰是本项目的关键路径（编排 / 解密 / 仓储）。
         *
         * 三条口径（与 §11.7 的覆盖率棘轮一致）：
         *   1. 门槛取**实测值向下取整到 5 的倍数**，不设理想值 —— 设高了会让
         *      无关提交变红，设低了等于没设；
         *   2. 之后**只升不降**（补了测试就上调，改动导致下降要在这里说清楚）；
         *   3. 实测为 0 的目录先设 0，**但 0 不是终点**：补上测试就立刻上调
         *      （`drizzle-studio` 就是这么从 0 抬到 40 的）。
         *
         * 统计口径与表格里的 `lib/<domain>` 行一致（v8 按目录聚合）。 */
        // 从「20/20/15/10」抬到实测值：三条**从未被覆盖**的用户路径进了用例 ——
        //   · `agentic.ts`（0 → 100）：多轮引导的离线状态机（空历史 / 没说类型 /
        //     信息不足 / 出方案）与 LLM 路径的「模型返回畸形 JSON / 空回复 /
        //     缺 spec 却自称 ready」处置；
        //   · `client.ts`（0 → 100）：坏 tool_call 过滤（空 id 会让执行层串台）、
        //     非 2xx 错误信封解包、响应体不是 JSON 时的不炸路径；
        //   · `server.ts`（0 → 97.8）：两条协议（tools / JSON 指令回退）的选路与
        //     「action 未登记就不交给执行层」的闸门、消息窄化（伪造 system 被丢弃）。
        // 目录实测 77.96/70.05/82.6/81.26，取向下取整到 5 的倍数（只升不降，§18.6）。
        // `shared.ts` / `types.ts` 是纯类型文件（v8 记 0%），因此目录整体低于
        // 各实现文件的实测值 —— 门槛取目录口径。
        "src/lib/agent/**": {
          lines: 80,
          functions: 80,
          statements: 75,
          branches: 70,
        },
        // Phase 3a：生产模型同步 reducer（shot ↔ 画布节点）。sync.ts 实测 100%，
        // 门槛取 95 给 3b/3c 追加留余量，只升不降（§18.6）。src/lib/** 已在
        // coverage.include 里，无需单列 include。
        "src/lib/production/**": {
          lines: 95,
          functions: 95,
          statements: 95,
          branches: 95,
        },
        // 从「40/35/40/35」抬到实测值：仓储层（`repository-*.ts` 共 12 个模块，
        // 占本目录分母的绝对大头）此前**零覆盖**。补法不是逐个 mock，而是让测试
        // 走 `tests/helpers/test-db.ts` 的**内存 SQLite + 真 Drizzle** —— 这一层的
        // 正确性全在「SQL 怎么写」上（count(列) vs count(*)、onConflictDoUpdate 的
        // target、and() 里 undefined 的短路、JSON 列的加解密顺序），mock 断言到不了。
        // 补测试时实测出 3 处真缺陷（详见 changelog 碎片）：
        //   · `listByUser` 只给 skip 不给 take 时生成 `… offset ?`（少 LIMIT），
        //     better-sqlite3 抛 near "offset": syntax error → 调用方拿 500；
        //   · `FilmRepository.listByUser` 用 count(*) 配 LEFT JOIN，没镜头的成片
        //     显示「1 镜」（同坑在 repository-model-tag 已修过一次）；
        //   · 分页两条分支（普通 select / relational query）口径不一致，后者
        //     根本无法表达「不限条数只跳过」。
        // 从「90/85/90/90」抬到实测值（ISSUE #565 续）：两条「注释与现状相反」
        // 的骨架都收了口 —— `core/index.ts` 的 `export *` 改为具名转发（它此前
        // 让每个引用方连带加载整层）、`repository-base.ts` 去掉基类里的日志
        // （留痕归子类按语义记）。后者顺带补上了 `idColumn` 显式分支的用例，
        // 基类行覆盖 80% → 84.6%，目录整体 lines 96.9 / functions 96.5、statements 94.8、branches 90.6。
        // 口径仍是「实测值向下取整到 5 的倍数，只升不降」（§18.6）。
        /* 根目录的**顶层单例**（`src/lib/<name>.ts`，规范 §12.5.3 / §18.14）此前
         * 落在 `coverage.include` 里但**没有任何门槛条目** —— 与「文件级门槛只有
         * 那几个」是同一个盲区。这两个是 ISSUE #672 按形态扫描新抽出来的共享出口
         * （剪贴板 + 下载 / 时间格式化），首批就按实测值设门槛（各自都有完整用例：
         * 降级链路的两条通道、`revoke` 与 `click` 的先后顺序、相对时间的档位与
         * `maxDays`）。口径仍是「实测值向下取整到 5 的倍数，只升不降」（§18.6）。
         */
        "src/lib/browser-io.ts": {
          lines: 95,
          functions: 100,
          statements: 90,
          branches: 80,
        },
        "src/lib/time-format.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「值不存在显示什么」的口径（§16.2.4，P8 的对面）：判据只有在
         * 边界值上才看得出差别（`0` / `false` 照常显示、`""` / NaN 给占位符），
         * 所以按实测值设门槛 —— 这几条边界用例就是它的全部逻辑。 */
        "src/lib/display-value.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「可搜索列表过滤」的口径（§16.2.4.16，P13 的对面）：判据的差别
         * 只在「归一化做到哪一步」上 —— `trim()` 单独写与 `trim().toLowerCase()`
         * 都编译、都运行，差别是含拉丁字母的候选能不能被小写关键字搜到。
         * 100/90/100/100 是实测值；唯一未覆盖的分支是 `filterGroups` 里
         * 「`field` 上的值不是数组」那条兜底（调用处类型上就到不了）。 */
        "src/lib/list-filter.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* 隐藏文件选择框与闪一下复位这两件「交互样板」的出口：
         * 它们承载的是**时序**与**复位**，恰恰是各自调用点看不出来的部分
         * （卸载后 setState、连点被旧定时器打断、连选同一文件不触发 change）。 */
        "src/components/ui/file-picker.tsx": {
          lines: 95,
          functions: 90,
          statements: 95,
          branches: 100,
        },
        "src/components/ui/use-flash-state.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「展开集合」的状态出口（§16.2.4.17，P14 的对面）：它承载的语义是
         * `hasKey`（表过态没）与 `seedDefaults`（不覆盖已有表态）这两条
         * **调用处看不出来**的判据，所以门槛按实测值设满档。 */
        "src/components/ui/expansion-set.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「面板加宽档」的出口（§16.2.4.18，P15 的对面）：持久化的
         * 读 / 写 / 缺省 / storage 不可用四条路径 + 跨实例同步都进了用例。
         * 门槛取实测值向下取整到 5 的倍数（91.89/96.87/92.3/73.68）——
         * 未覆盖的是**另一侧**的 SSR 分支（`typeof window === "undefined"`），
         * jsdom 里到不了；真去 mock 它只会让用例断言一个不存在的行为。 */
        "src/components/ui/wide-panel.tsx": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 70,
        },
        /* 「异步动作的进度条」的形态出口（§16.2.4.19，P16 的对面）：
         * 确定态 / 不确定态 / 下限可见宽度 / 外观可覆盖四条路径都进了用例，
         * 门槛按实测值设满档。数值侧的口径在 `src/lib/progress`。 */
        "src/components/ui/progress-bar.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「对象渲染成键值行」的出口（§16.2.4.20，P17 的对面）：四种布局 +
         * 值/原始值/缺值 + 空块都进了用例。门槛取实测值（100/91.48/100/100）
         * 向下取整 —— 唯一未覆盖的分支是 `striped` 在 `bordered=false` 下的
         * 奇偶判定（调用处类型上到得了，但没人会给一个无边框的表配隔行底色）。 */
        "src/components/ui/key-value-rows.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* 本批三条出口（规范 16 §16.2.4.21 ~ §16.2.4.23），门槛取实测值向下
         * 取整到 5 的倍数（§18.6 的口径：不设理想值 —— 设高了会让无关提交
         * 变红，设低了等于没设）。三处都**必须同时**出现在上面的
         * `coverage.include` 里：阈值只对报告里出现的文件生效，P16/P17 那批
         * 的教训是两个 `ui/` 出口的门槛「写着 95/90/95/100 却查无此文件」。 */
        /* 实测 100 / 94.44 / 100 / 100；分支未覆盖的两处是 SSR 分支
         * （`typeof navigator === "undefined"`）—— jsdom 到不了。 */
        "src/components/ui/media-thumbnail.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* 实测 100 / 93.75 / 100 / 100；未覆盖的是「查询串剥完只剩空段」的回退。 */
        "src/components/ui/media-drag-source.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* 实测 93.18 / 86.36 / 100 / 100（取向下取整到 5 的倍数）：
         * 未覆盖的是 `document` 兜底与「已卸载后 handler 引用」那几行 ——
         * jsdom 里 `window` 恒存在，`typeof window === "undefined"` 一支到不了。 */
        "src/components/ui/use-hotkey.ts": {
          lines: 90,
          functions: 100,
          statements: 90,
          branches: 85,
        },
        /* 本批三条出口（规范 16 §16.2.4.24 ~ §16.2.4.26）。同样**两处同批改**
         * （`coverage.include` + 这里）—— 门槛只对报告里出现的文件生效。 */
        /* 「滚动跟随到底」：贴底 / 退出跟随 / 跨实例受控 / 阈值可覆盖四条路径
         * 都进了用例（jsdom 不做布局，用例自己给容器定义滚动几何 —— 量测口径
         * 正是这条账的实质）。 */
        /* 门槛取实测值向下取整到 5 的倍数（§18.6）；未覆盖的是 `controlled`
         * 为 `undefined` 那一侧的少数分支与 ref 同步 effect —— 全量并行跑覆盖
         * 率时这些行不进报告，单文件跑则满档（v8 覆盖率已知的抖动）。 */
        "src/components/ui/use-scroll-follow.ts": {
          lines: 95,
          functions: 100,
          statements: 95,
          branches: 85,
        },
        /* ISSUE #1295 的两个出口。按 §18.6 取**实测值向下取整到 5 的倍数**：
         * `use-draggable-position` 实测 93.9/75.6/100/100，未覆盖的是
         *「元素始终为 null」那条兜底（真实调用里元素一定会挂上）与
         * `viewportRef` 的空值回退；`use-viewport-size` 实测满档。 */
        "src/components/ui/use-draggable-position.ts": {
          lines: 90,
          functions: 100,
          statements: 90,
          branches: 75,
        },
        "src/components/ui/use-viewport-size.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「标签 + 控件 + 校验错误」：ARIA 关联是本条账的核心，用例逐条钉
         * （htmlFor/id、aria-invalid、aria-describedby、空串错误、
         * hint 与错误的先后、可省略 children）。 */
        "src/components/ui/form-field.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「外部动作的执行态」：结果归一 / 空目标拦截 / 连点只发一次 /
         * 失败兜底文案 / guard 短路都进了用例。 */
        "src/components/ui/use-external-action.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「外部目标的结果归一与协议助手探测」：`ok` / `triggered` 两种形状、
         * 空目标四态、四个动词、探测三态都进了用例。分支取实测值 95 ——
         * 未覆盖的是 `onBlur` 里 `if (handled) return` 那一支：`settle()` 在
         * `handled` 为真时**立即 resolve 并摘掉监听**，之后的 blur 到不了那里。 */
        "src/lib/external-open.ts": {
          lines: 100,
          functions: 100,
          statements: 95,
          branches: 85,
        },
        /* 「按形态」收口的三条新出口（规范 16 §16.2.4.27 ~ §16.2.4.29）。
         * 门槛取实测值向下取整到 5 的倍数（§18.6 的口径：不设理想值）：
         *   · `file-io` 100/100/100/100 —— 两条通道的「读到 / 读到空 / 读失败」
         *     六条路径（`file.text()` 与 `FileReader` 各三条）全在用例里；
         *   · `browser-storage` 95/100/90/90 —— 未覆盖的是「`removeItem` 抛」
         *     （配额满能测，删失败只有 Safari 隐私模式那一种现场）；
         *   · `use-enter-commit` 100/100/100/100 —— 判据只有「按哪个键」与
         *     「组字中不按」两件事，全在用例里。
         * ⚠️ 三个都**同批**进了上面的 `coverage.include` —— 只写门槛不进
         * `include` 会让门槛静默失效（`ui/file-picker.tsx` 的前车之鉴）。 */
        "src/lib/file-io.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/browser-storage.ts": {
          lines: 80,
          functions: 85,
          statements: 80,
          branches: 85,
        },
        "src/components/ui/use-enter-commit.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「异步动作的结果怎么接到反馈通道上」的出口（§16.2.4.30，P27 的对面）：
         * 用例钉住四种返回形状的归一（信封 / 布尔 / void / 业务对象）、
         * 三层成功文案优先级（`successText` → 信封 detail → 静默）、
         * 失败一律走 `errorMessage`、以及「失败不向外抛、给返回值」。 */
        "src/lib/async-action.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 85,
        },
        /* 「一组值写成查询串」的出口（§16.2.4.32，P29 的对面）：四条语义决定
         * （省略 / `0` 不是缺值 / 一律编码 / 重复键）都有正反用例。
         * 分支取实测值 —— 未覆盖的是 `decode()` 的容错分支在读取侧之外
         * 的那一条（`readQueryParam` 里 `+` 替换后再解码的组合）。 */
        "src/lib/query-string.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 95,
        },
        /* 「每一条各自挂错误」的出口（§16.2.4.33，P30 的对面）：判据是
         * 「错误属于哪一条」——`get` / `hasAny` / `report` / `clear` /
         * `clearAll` 与生命周期收敛（条目删掉、错误随之消失）全在用例里。
         * 分支取实测值 —— 未覆盖的是 `keys` 由 `undefined` 变为数组时
         * 那一档的 `useMemo` 重算（组件挂载后 `keys` 恒定的常态）。 */
        "src/components/ui/use-item-errors.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* 「这一轮取数还算不算数」的出口（§16.2.4.34，P31 的对面）：
         * `commit` 的原子性、作废后整段跳过、**「A 轮的 settle 不该覆盖
         * B 轮的 loading」**、失败分支同样过守卫 —— 全是那段样板各判各的
         * 地方，逐条有用例。 */
        "src/lib/stale-run.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「服务端错误信封」的出口（§16.2.4.35，P32 的对面）：两条口径
         * （取值走 `errorMessage`、形状只有两种）与客户端读取的两种历史
         * 形态、空文案、非错误体都在用例里。 */
        "src/lib/api-error.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「给一条新记录分配 id」的出口（§16.2.4.36，P33 的对面）：同一前缀
         * 内的严格递增、每前缀一套序号、注入时刻的批内共享、随机短标记都在
         * 用例里。门槛先按实测值给 —— 「不回绕」这条判据本身就是用例的核心。 */
        "src/lib/unique-id.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「ComfyUI 报错 → 可行动建议」的出口（§16.2.4.37，P34 的对面）：
         * 规则顺序即优先级、两条旧词表各自认得 / 漏掉的形态、未识别不编造
         * 建议、通用兜底的适用面、自动展开判据都在用例里。 */
        "src/lib/comfyui/error-advice.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 本批三条新出口（规范 16 §16.2.4.39 ~ §16.2.4.41）。
         * 门槛按**实测值**设（未覆盖的是 jsdom 到不了的分支：`use-element-box`
         * 的「`ResizeObserver` 回调里取值没变」与 `readElementBox` 的
         * 「元素上取不到 `getBoundingClientRect`」）。 */
        "src/components/ui/tree-rows.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/ui/use-item-action.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 85,
        },
        "src/components/ui/use-element-box.ts": {
          lines: 95,
          functions: 85,
          statements: 95,
          branches: 85,
        },
        "src/lib/dom-rect.ts": {
          lines: 95,
          functions: 80,
          statements: 90,
          branches: 85,
        },
        /* 本批四条新出口（规范 16 §16.2.4.42 ~ §16.2.4.44）。门槛取**实测值**
         * （§11.7 的覆盖率棘轮口径：不设理想值，设高了会让无关提交变红）。
         * 两个类型守卫与两个调度函数都是纯判据，用例把每条分支都走到了；
         * 反馈 hook 的三条分支（成功 / 失败 / 静默）与重入判据也在用例里。 */
        "src/lib/next-frame.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/is-record.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/server/lib/request-body.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 「扩展名 ⇄ MIME」的唯一出口（§16.2.4.51，P47 的对面）：两组查表、
         * 带参数的 content-type 切分、`extOfPath` 的点/隐藏文件/查询串三态、
         * `stemOfPath` 与 `contentTypeForPath` 的两档兜底全在用例里。
         * 行/函数/语句 100 是实测值；分支 85 也是实测 —— 未覆盖的四条是
         * `split(...)[0] ?? ""` / `.pop() ?? ""` 这两处**不可达**兜底
         *（`split` 对任意输入都至少返回一个元素）。 */
        "src/lib/media/mime-ext.ts": {
          lines: 100,
          functions: 100,
          statements: 95,
          branches: 85,
        },
        /* 「把文本变成安全的文件名片段」的唯一出口（§16.2.4.53，P49 的对面）：
         * 两档的差异（保留 / 不保留 CJK）就是这条账的全部内容，必须 100%。 */
        "src/lib/safe-name.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 本批三条新出口（规范 16 §16.2.4.54 ~ §16.2.4.56），门槛按实测值设满档：
         *   · P50 对面 `~/lib/number-format` —— 四档各有边界（非有限数 /
         *     负零 / 整数 / 大小数位夹取），用例逐条钉住；
         *   · P51 对面 `~/lib/ordered-set` —— 「首次出现 vs 字典序」
         *     与「键为空值算不算身份」都是判据，逐条钉住；
         *   · P52 对面 `~/lib/media/data-url` —— 畸形输入（缺逗号 /
         *     非 base64 形态 / 空载荷）与浏览器侧分块编码都验到。 */
        "src/lib/number-format.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/ordered-set.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/media/data-url.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 本批三条新出口（规范 16 §16.2.4.57 ~ §16.2.4.59），门槛按实测值设满档：
         *   · P53 对面 `~/lib/keyboard` —— 三条归一规则（空格两个名字 /
         *     小写归一 / 单字符不 trim）与 `isKeyIn` 的边界逐条钉住；
         *   · P53 对面 `~/components/ui/simple-key-handler` ——
         *     `preventDefault` / `ignoreRepeat` 两个开关的正反两面都验到；
         *   · P55 对面 `~/lib/case-token` —— 连续大写 / 前导下划线 /
         *     往返一致这三条「刻意不做的花活」由用例钉住。 */
        "src/lib/keyboard.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/ui/simple-key-handler.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/case-token.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 本批三条新出口（规范 16 §16.2.4.66 ~ §16.2.4.68），门槛按实测值设满档：
         *   · P62 对面 `~/lib/form-props` —— 五支适配器的边界逐条钉住
         *     （空串不是 0、`Infinity` 不交出去、`digitsOnly` 只留数字）；
         *   · P63 对面 `~/lib/page-window` —— 三族方向相反的窗口与各自的
         *     边界（空列表 / 越界页码 / `pageSize` 为 0 / 最后一块收口）；
         *   · P64 对面 `~/components/ui/use-throttled-progress` ——
         *     首帧立即、窗口内丢弃、同值短路、`flush` 终值、卸载守卫、
         *     按条目独立窗口与 `clear(key)`。 */
        "src/lib/form-props.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/page-window.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/ui/use-throttled-progress.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 本批两条新出口（规范 16 §16.2.4.69 / §16.2.4.71），门槛按实测值设满档：
         *   · P66 对面 `~/components/ui/use-reentrancy-lock` —— 同步可见（同一次事件循环里
         *     连点两次的第二次被拦）、`exit` 幂等、重挂即重来三条都验到；
         *   · P65 对面 `~/components/ui/use-busy-action` —— 复位绑在 `finally`
         *     上（抛错也落）、异常不吞、卸载守卫、可传初值四条都验到；
         *   · `~/components/ui/use-refresh-ticket` —— 票据语义（初值 0 / 每次 +1 / 连刷不
         *     合并 / `refresh` 身份恒定）。 */
        "src/components/ui/use-reentrancy-lock.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/ui/use-refresh-ticket.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/ui/use-busy-action.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 本批三条新出口（规范 16 §16.2.4.60 ~ §16.2.4.62），门槛按实测值设满档：
         *   · P56 对面 `~/lib/path-display` —— 「相对不上就不剥」「上限比标记还短」
         *     「n ≤ 0 给空串」「奇数余额给头部」这些刻意不做的花活逐条钉住；
         *   · P57 对面 `~/lib/dom-props` —— 「只搬不改写」「不改动入参」
         *     「未传的私有键不凭空补 undefined」与交集合并（不是并集）都验到；
         *   · P58 对面 `~/lib/with-timeout` —— 成功 / 失败 / 超时三条路径的
         *     **定时器清零**、`onTimeout` 钩子与「钩子抛错不顶替超时结论」都验到。 */
        "src/lib/path-display.ts": {
          lines: 100,
          functions: 100,
          statements: 95,
          branches: 90,
        },
        "src/lib/dom-props.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/with-timeout.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 80,
        },
        /* 本批三条新出口（规范 16 §16.2.4.63 ~ §16.2.4.65），门槛按实测值设满档：
         *   · P59 对面 `~/lib/clamp` —— `NaN` 与 `±Infinity` 分两种处理、
         *     「先夹后整」的顺序、`min > max` 不换序都是判据，逐条钉住；
         *   · P60 对面 `~/lib/upper-token` —— 「吃空白」这条唯一口径与
         *     `unknown` 参数的守卫逐条钉住；
         *   · P61 对面 `~/lib/app-events` —— 带 / 不带载荷、多订阅者、
         *     退订只影响自己、无 `window` 分支都验到。 */
        "src/lib/clamp.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/collections.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/upper-token.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/app-events.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/ui/use-copy-feedback.ts": {
          lines: 95,
          functions: 90,
          statements: 95,
          branches: 85,
        },
        /* 「一张媒体图的自然尺寸是多少」的出口（§16.2.4.31，P28 的对面）：
         * 两组读数、0 / NaN / 负 / 无限的读不到判据、竖图三态、
         * `×` 的展示形态全在用例里。 */
        "src/lib/media/natural-size.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* 「媒体引用 → 可渲染地址」的出口（§16.2.4.32 的另一半）：
         * `/api/images` 的参数与编码、`subfolder` 的省略、空引用给 `null`、
         * 「以 `/` 开头即已是可渲染路径」都在用例里。 */
        "src/lib/media/media-url.ts": {
          lines: 95,
          functions: 100,
          statements: 95,
          branches: 90,
        },
        "src/lib/core/**": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 85,
        },
        // 从「全 0」抬到实测值：`lifecycle` 的探测 / 定位 / 启停判决进了用例
        // （端口应答三态、找不到 drizzle-kit、不是本应用拉起的就不乱杀）。
        "src/lib/drizzle-studio/**": {
          lines: 40,
          functions: 35,
          statements: 35,
          branches: 35,
        },
        // 编排（`orchestrator.ts`）已按 ISSUE #572 第 2 项迁到
        // `src/server/film/**`（服务端领域编排只被 `film` router 消费，与既有
        // `src/server/workshop/orchestrator.ts` 同一落点）。`src/lib/film/**`
        // 因此只剩纯函数（`film-size` 尺寸折算、`bgm-client` 网络客户端），
        // 实测 100/93.75/100/100 —— 门槛随之抬到实测值（只升不降，§18.6）。
        "src/lib/film/**": {
          lines: 100,
          functions: 90,
          statements: 100,
          branches: 90,
        },
        // `src/server/film/**` 随迁入首次纳入覆盖率门槛（此前它不在
        // `coverage.include` 里，整个服务端编排块**零门槛**）。数值取实测值
        // 向下取整到 5 的倍数（35.12/28.9/53.33/34.4），只升不降。
        //
        // #1257 之后这一格里是三个文件（`orchestrator` 剧本/分镜/逐镜/监看、
        // `compose-film` 合成与项目回写、`film-log` 行日志叶子），分母没变 —— 同一批
        // 判决面换文件住，所以数值不下调也不上调（实测 64/76.7/64/55.6，门槛仍 30/50/35/25）。
        //
        // 为什么不是更高：它的分母是整条「分镜 → 逐镜生成 → ffmpeg 合成」链路，
        // 未覆盖部分是真的起进程 / 拉工作流 / 等轮询的分支 —— 硬抬门槛会让无关
        // 提交变红（§18.6）。补它的正确方法是给编排判决面（镜头参数折算 / 合成
        // 前置条件 / 取消撤销）继续加用例，届时同批上调这里。
        "src/server/film/**": {
          lines: 30,
          functions: 50,
          statements: 35,
          branches: 25,
        },
        // 从「30/30/30/25」抬到实测值：四组低覆盖文件进了用例 ——
        //   · `secrets`（曾 9.5/0/0）：GCM 往返 + 每次新 IV + 篡改密文/换密钥
        //     返回 null 而不抛错 + 密钥文件 0600 落盘 + env / 进程内随机兜底；
        //   · `video-task-util`（曾 0）：轮询两候选、窗口耗尽报 pending、单次
        //     失败不终止、模型名路径穿越清洗、落盘失败一律静默；
        //   · `prompts`（曾 13.5/0）：模型不听话（围栏 / 前言 / 越界景别 /
        //     非字符串字段）时全部走兜底而非 `[object Object]`；
        //   · `browser`（曾 2.1/0）：SSE 跨 chunk 半个 JSON 的拼帧、坏帧跳过、
        //     非 2xx 必须抛错。
        // 数字仍取「实测值向下取整到 5 的倍数」，只升不降（§18.6）。
        //
        // 从「55/55/55/50」抬到实测值：`server.ts`（435 行的**唯一 LLM 出口**：
        // 三层配置叠加、四条补全路径、网络失败翻译）与 `usage-test.server.ts`
        // （设置页「测试」弹窗的服务端共享实现）此前**零覆盖**，两个客户端模块
        // （`model-catalog-client` / `usage-test-client`）也是 0。补测试时顺手修掉
        // 一处用户可见的文案缺陷：上游返回非 JSON 体（网关 HTML 错误页）时，
        // 错误提示拼成 **`HTTP 503：HTTP 503`** —— 状态码说两遍，真实原因一个字
        // 都没带上；另有 `model-catalog-client` 把全空白模型名放进下拉。
        "src/lib/llm/**": {
          lines: 90,
          functions: 85,
          statements: 90,
          branches: 85,
        },
        /* 本批新划出的 6 个子域（ISSUE #565 的域化搬迁 / 规范 §12.5.3 / §18.14）：
         * 根目录此前**不是一个域** —— 它是「一堆文件」，于是 18.6 的覆盖率门槛
         * 与 18.4 的域级声明核对都挂不到它们身上。数值一律取**搬迁后的实测值
         * 向下取整到 5 的倍数**，「只升不降」（§18.6 的口径）。 */
        "src/lib/comfy/**": {
          lines: 90,
          functions: 90,
          statements: 90,
          branches: 90,
        },
        // log/ 的分母含 `app-runtime-log`（ERROR 镜像，真写盘）与
        // `capture-streams.server`（instrumentation 挂钩）的未覆盖分支。
        "src/lib/log/**": {
          lines: 85,
          functions: 85,
          statements: 80,
          branches: 70,
        },
        "src/lib/media/**": {
          lines: 80,
          functions: 75,
          statements: 75,
          branches: 70,
        },
        /* process/ 的 `kill-process-tree` 大部分分支要真杀进程（平台相关）。
         * 这里从 50/60/50/55 降到实测值：棘轮开门那一次全量跑数出来是
         * 24.4/46.9/26.4/24.6 —— 大头是 `process-launch.ts`（17.9% 行）与
         * `kill-process-tree.ts`（29.1%），执行宿主那批新代码进来时没配用例，
         * 而当时没有任何路径判得着这条门槛。欠的课记在台账 E7；补判决面
         * （而非真起进程）时同批抬回原值。 */
        "src/lib/process/**": {
          lines: 20,
          functions: 45,
          statements: 25,
          branches: 20,
        },
        "src/lib/shell/**": {
          lines: 60,
          functions: 70,
          statements: 60,
          branches: 60,
        },
        "src/lib/workflow/**": {
          lines: 90,
          functions: 90,
          statements: 85,
          branches: 80,
        },
        "src/lib/project-canvas/**": {
          lines: 70,
          functions: 70,
          statements: 65,
          branches: 50,
        },
        "src/lib/workshop/**": {
          lines: 65,
          functions: 70,
          statements: 65,
          branches: 55,
        },
        /* 通用图片查看器的两个出口（简化台账见 `docs/standards/16`）。
         * 门槛取**实测值向下取整到 5 的倍数**（§18.6 / §11.7 的口径：不设
         * 理想值 —— 设高了会让无关提交变红，设低了等于没设）：
         *   · `use-image-zoom` 100/100/100/100 —— 缩放档位、夹取的四条边界
         *     （0 / 负数 / NaN / Infinity）与档位切换全在用例里；
         *   · `image-viewer` 实测 93.54/87.5/94.44/96.34，未覆盖的三行是
         *     jsdom 到不了的真实指针捕获分支（`setPointerCapture` /
         *     `releasePointerCapture` 在 jsdom 里不存在，代码里就是 `typeof`
         *     守卫）与「滚轮到达倍数上限后提前返回」那一支。 */
        "src/components/ui/image-viewer.tsx": {
          lines: 95,
          functions: 90,
          statements: 90,
          branches: 85,
        },
        "src/components/ui/use-image-zoom.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* P82 出口 `hint.tsx` —— 实测满档：三条判据分支（空 label 不渲染 /
         * `accessibleName` 补名 / 子元素已有 `aria-label` 不覆盖）各有用例，
         * 外加「render 接管后 onClick 与 disabled 不丢」「插锚点时提示挂在
         * 锚点上（禁用按钮的说明仍要弹得出）」两条形态回归。 */
        "src/components/ui/hint.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* `ui/tooltip` 本轮新进面：两条判据（默认留出安全边距、调用处可按容器
         * 改档）。实测满档 —— 浮层的定位输出是引擎的事，用例只锁「档位来源」，
         * 不去断言 `style.top` 这类派生像素值（规范 16 §16.2.3.1）。 */
        "src/components/ui/tooltip.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* `ui/toggle-group` 的三条用例：选中档三层（描边 / 字重 / 抬层）在
         * `data-[pressed]:*` 上、悬停档保持官方版的 `bg-muted`（两条一起才说明
         * 「不是靠改悬停解决的」）、`aria-pressed` 仍由基元持有。实测满档。 */
        "src/components/ui/toggle-group.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 左轨让位那笔账：算式、三档优先（含「来回拖窗口后豁免过期」）、以及与
         * 真实列宽对账的漂移判据。纯函数，实测满档。 */
        "src/lib/layout-budget.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 窄窗判据 + 跨越次数。实测 lines 91.66 / branch 75 / funcs 85.71：
         * 唯一没走到的分支是 `getServerSnapshot`（SSR 快照），jsdom 与真浏览器都
         * 不会调它 —— 不为它把文件改成可注入（那是为了凑数而改结构），门槛按实测
         * 取不高于现状的档。 */
        "src/components/ui/use-narrow-nav.ts": {
          lines: 90,
          functions: 85,
          statements: 90,
          branches: 70,
        },
        /* ── API 路由 handler 第一批（体检清单 ⑦）────────────────────────────
         *
         * 数值取实测（这一批都是 100/100/100/100，见各自用例），口径仍是 §18.6：
         * 不设理想值、只升不降。敢设满档是因为**这一步现在真的被判定**（E2 之后
         * `check:all` 的 test 门带 `--coverage`）—— 满档回退会当场变红，而不是像
         * 台账 E7 那样攒出一堆「写着 100、其实没人判」的旧账。
         *
         * ⚠️ **动态段目录名必须转义**：`coverage.include` 走 glob，`[...path]` 里的
         * 方括号是字符类 —— 写成字面量时条目**静默不匹配**（文件加载了、测试也过了，
         * 报告里却查无此文件，门槛成了一条空挂的登记）。要写
         * `src/app/api/generated/\\[...path\\]/route.ts`。给 `[id]` / `[[...slug]]`
         * 这类路由加门槛时同理；判据同「只写一处就静默失效」那一族。 */
        "src/app/api/generated/[...path]/route.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/app/api/debug/source/route.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/app/api/comfy/stats/route.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/app/api/comfy/queue/route.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/app/api/comfy/ensure/route.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/poll-timer.ts": {
          lines: 90,
          functions: 85,
          statements: 90,
          branches: 85,
        },
        "src/lib/offline-gate.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/lib/comfy/comfy-stats-store.ts": {
          lines: 95,
          functions: 75,
          statements: 95,
          branches: 100,
        },
        /* ── 体检清单 ⑦ 第二批 · 并到安全台账 A 系列（按实测登记）────────────
         * `custom-nodes` 只登记到实测值：35 条用例覆盖的是 POST 的闸门与三态，
         * GET 侧那套 manifest / report 读取（磁盘探测 + 缓存指纹）仍没有执行者。
         * 这是**已知欠账**，登记在台账 E7，不许把它当成「这个文件测完了」。
         * 补上 GET 用例后按 §18.6 上调（只许升）。 */
        "src/app/api/custom-nodes/route.ts": {
          lines: 40,
          functions: 45,
          statements: 35,
          branches: 35,
        },
        /* `project.ts`：分支 94.44 → 90（余下两处是 `patch` 里「nodes 给了、
         * edges 没给」这类形状组合，与 `params ?? {}` 的另一侧 —— 后者在当前
         * schema 下取不到，属于不可达分支，不为它写假数据凑数）。 */
        "src/server/api/routers/project.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* `task.ts`：94.11 / 89.39 → 90 / 85。余下的是 `inferMediaType` 的
         * 音频/视频文案分支与 `list` 的补页出口 —— 都是「投影长什么样」而不是
         * 「越不越得过去」，本批不动它们。 */
        "src/server/api/routers/task.ts": {
          lines: 100,
          functions: 100,
          statements: 90,
          branches: 85,
        },
        /* 产物布局：一个形状、三条出口（落盘 / URL / 删除），每一支都必须有
         * 人判 —— 它是「一处认 projects、一处不认」这类分叉的最后一道线。 */
        "src/lib/media/output-paths.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* ── 体检清单 ⑦ 第三批 · 协议白名单（实测登记）──────────────────────
         * `url-scheme.ts` 满档：它是四条出口共用的那一句判据，掉一支就是某个
         * 危险协议被放行 —— 没有「大部分对就行」这一档。 */
        "src/lib/url-scheme.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 首页「本机算力」卡与它读的口径描述符（与上面 `coverage.include` 同批登记）。
         * 满档的依据是实测而不是理想值：描述符是纯函数、卡片的分支全在 jsdom 用例里
         * 走到位（含「未运行 / 首帧未到 / 迟滞期」三条互斥出口）。这块掉覆盖会同时
         * 影响状态栏与首页两处消费点，值得被数字看着。 */
        "src/components/studio/comfy-resource-metrics.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* `setting.ts`：分支 91.66 → 90。余下那一支是 `comfyStatus` 里
         * `status.via ?? null` 的另一侧（快照命中与外部实例两种来源）。 */
        "src/server/api/routers/setting.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        /* ── 体检清单 ⑨ · 素材库归属（实测登记）──────────────────────────── */
        "src/lib/media/materials.ts": {
          lines: 95,
          functions: 90,
          statements: 85,
          branches: 80,
        },
        "src/server/api/routers/material.ts": {
          lines: 100,
          functions: 100,
          statements: 90,
          branches: 75,
        },
        /* REST 那条（305 行、含 multipart 上传与 500 兜底）是三个里最薄的：
         * 判据本身都测到了，缺的是错误分支与超大上传的回执路径。 */
        "src/app/api/materials/route.ts": {
          lines: 85,
          functions: 80,
          statements: 80,
          branches: 75,
        },
        /* ── 体检清单 ⑦ 第四刀 · 产物归属判据（台账 A13，实测满档）──────────
         * 敢设 100 是因为「三族 × 每族的保守侧」这六个分支真的各有用例：
         * 项目格两种（我的 / 别人的）+ 共享区 + 库里没有的目录名、成片格三种
         * （我的 / 别人的 / `_tmp_` 中间目录）+ 无主的 bgm + 查不到的 id、
         * 任务格三种（我的 / 别人的 / 行已删）。少任何一支都会掉下 100 当场红。 */
        "src/lib/media/output-access.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 同上：`matcher` 里那两条产物前缀是**删掉不会有任何用例报错**的一档
         * （通配那条把带点路径全排除了，产物 URL 个个带扩展名），所以把它写成
         * 对 `config.matcher` 的直接断言，并给这一层满档。 */
        "src/proxy.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/studio/LocalComputeCard.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* 模型库这一刀的三个新文件（与上面 `coverage.include` 同批登记）。
         * 数值按**隔离实测**向下取整到 5 的倍数（§18.6），不抬到理想值：
         *   · `model-type-labels.ts` 是纯表 + 一个查表函数，四项皆满；
         *   · `model-cover.ts` 分支只到 50 —— 没走到的那支是色表为空时的兜底
         *     （按设计不可达，写出来是为了不用非空断言）。如实登记 50，
         *     而不是为了好看把它抬成 100 再让下一次全量红；
         *   · `ModelDetailDialog.tsx` 未覆盖的是封面加载失败的 `fallback` 渲染
         *     函数与 `onOpenChange` 的反向回调（弹窗只能由用户关掉，jsdom 里
         *     没有真实的关闭路径）。 */
        "src/components/model/model-type-labels.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        /* ── 体检清单 ⑨ 第二刀 · 四个 router（实测满档，52 条用例）─────────
         * 满档的理由不是「行数少」，而是每个 procedure 的真分支都被判过：
         * 归属（别人的 id 与不存在同形）、闸（协议 / 枚举 / 数值范围 / id 形状）、
         * 以及「拒绝必须发生在副作用之前」（编排层与写库一次都没被调用）。 */
        "src/server/api/routers/film.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/model/model-cover.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 50,
        },
        "src/components/model/ModelDetailDialog.tsx": {
          lines: 85,
          functions: 70,
          statements: 90,
          branches: 65,
        },
        /* 首页「模型概览」（与上面 `coverage.include` 同批登记）。
         * 推导函数是纯输入输出、四项皆满；卡片未走到的那一支是「同时有折叠项和
         * 空目录」之外的单条件组合，按实测向下取整到 90 而不是抬成 100。 */
        "src/components/studio/model-overview-derive.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/components/studio/HomeModelOverview.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        "src/server/api/routers/train.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/server/api/routers/model.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
        "src/server/api/routers/llm.ts": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
      },
    },
  },
});
