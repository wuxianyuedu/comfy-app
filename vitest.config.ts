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
        /* P82 的合规出口（悬停提示收成一处，规范 16 §16.2.3 / §12.18 补地基）。
         * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
        "src/components/ui/hint.tsx",
        /* `ui/toggle-group` 的选中档三层是本仓库的定制（规范 16 §16.8），
         * 有用例钉住就得进门槛。同款 **两处同批改**。 */
        "src/components/ui/toggle-group.tsx",
      ],
      exclude: ["src/lib/**/*.test.ts"],
      thresholds: {
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
          functions: 95,
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
          statements: 100,
          branches: 95,
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
          lines: 95,
          functions: 100,
          statements: 90,
          branches: 90,
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
          statements: 100,
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
          statements: 100,
          branches: 100,
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
          branches: 100,
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
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 90,
        },
        "src/lib/core/**": {
          lines: 95,
          functions: 95,
          statements: 90,
          branches: 90,
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
          statements: 85,
          branches: 70,
        },
        "src/lib/media/**": {
          lines: 80,
          functions: 75,
          statements: 75,
          branches: 70,
        },
        // process/ 的 `kill-process-tree` 大部分分支要真杀进程（平台相关），
        // 实测 52/61 —— 门槛按实测值设，补判决面（而非真起进程）时同批上调。
        "src/lib/process/**": {
          lines: 50,
          functions: 60,
          statements: 50,
          branches: 55,
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
        /* `ui/toggle-group` 的三条用例：选中档三层（描边 / 字重 / 抬层）在
         * `data-[pressed]:*` 上、悬停档保持官方版的 `bg-muted`（两条一起才说明
         * 「不是靠改悬停解决的」）、`aria-pressed` 仍由基元持有。实测满档。 */
        "src/components/ui/toggle-group.tsx": {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 100,
        },
      },
    },
  },
});
