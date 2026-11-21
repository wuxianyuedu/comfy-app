/** 覆盖率门槛表（**纯数据**，ISSUE #4612 自 vitest.config.ts 抽离）：vitest.config.ts 只做装配，
 * 数字的登记、口径（§11.7 / §18.6 的「只升不降 + 实测值向下取整到 5 的倍数」）与
 * 「每条门槛都要落到真实文件」的判据（tests/coverage-targets-exist.test.ts）不变。
 * 分片只按长度门禁落点，键与数值的语义跨片一致。
 * ⚠️ include ⇄ thresholds 是**两处同批改**的成对清单：只写一边 = 门槛静默失效
 * （ui/file-picker.tsx 的前车之鉴）。本文件按 900 行长度硬闸（§12.13）分份存放，
 * 新增条目进哪一份都行（键语义不变），别为省一次查找把它们合并回去。
 */

export const COVERAGE_THRESHOLDS = {
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
  /* 锚定浮层的碰撞边界：壳态 / 非壳态 / 首帧（视口未知）三条判据都有用例，
   * 实测满档。 */
  "src/components/ui/use-overlay-boundary.ts": {
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
  "src/components/ui/simple-key-handler.ts": {
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
  "src/components/ui/use-copy-feedback.ts": {
    lines: 95,
    functions: 90,
    statements: 95,
    branches: 85,
  },
  /* 「一张媒体图的自然尺寸是多少」的出口（§16.2.4.31，P28 的对面）：
   * 两组读数、0 / NaN / 负 / 无限的读不到判据、竖图三态、
   * `×` 的展示形态全在用例里。 */
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
  /* 「一排里选一个」的 chip（ISSUE #1423）：四种形态的类名档、选中档的
   * 四层、以及**本次真正要防的那一条** —— 选中档必须自带 hover 覆盖。
   * 三轴 + 形态 + 语义 + className 压过缺省档，实测四维满档（§18.6：
   * 门槛按实测值取，只升不降）。 */
  "src/components/ui/select-chip.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 左轨让位那笔账：算式、三档优先（含「来回拖窗口后豁免过期」）、以及与
   * 真实列宽对账的漂移判据。纯函数，实测满档。 */
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
  "src/components/studio/comfy-resource-metrics.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* `setting.ts`：分支 91.66 → 90。余下那一支是 `comfyStatus` 里
   * `status.via ?? null` 的另一侧（快照命中与外部实例两种来源）。 */
  "src/components/studio/LocalComputeCard.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 外观偏好模块（与 coverage.include 同批）。数值取隔离实测向下取整到 5：
   * 行满档；未走到的两支是「档位表里找不到 id 时的兜底取值」，
   * 语义上已被「不认就整份回落」那组用例覆盖，不为凑分支数造夹具。 */
  "src/components/studio/ViewContainer.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 壳内应用级页签容器（与 `coverage.include` 同批）。隔离实测四项都 100，
   * 满档不是凑出来的：三分支（有 `blockedReason` / 有 `url` / 两者都没有）、
   * 壳形态与浏览器形态、页签切换的显隐与 `aria-hidden`、以及说明里那颗
   * 「复制地址」的成败两条回调，各自都有用例点到（`ShellTabs.test.tsx`）。
   * 这一格值得被数字看着：它掉一支，用户看到的就是一片空白页签，
   * 而全仓库不会有任何东西变红（ISSUE #1244 立案时的现场）。 */
  "src/components/studio/ShellTabs.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 视图页签条（与 `coverage.include` 同批）。数值取隔离实测向下取整到 5：
   * 未覆盖的 158-160 是「+」菜单里那一行的点击 —— jsdom 里下拉不展开，
   * 该路径由 `e2e/view-tabs.spec.ts` 在真浏览器判到，不为此造夹具。 */
  "src/components/studio/ViewTabStrip.tsx": {
    lines: 85,
    functions: 75,
    statements: 85,
    branches: 75,
  },
  /* ── 体检清单 ⑨ 第二刀 · 四个 router（实测满档，52 条用例）─────────
   * 满档的理由不是「行数少」，而是每个 procedure 的真分支都被判过：
   * 归属（别人的 id 与不存在同形）、闸（协议 / 枚举 / 数值范围 / id 形状）、
   * 以及「拒绝必须发生在副作用之前」（编排层与写库一次都没被调用）。 */
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
  "src/components/workshop/shot-status-config.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/components/workshop/ShotFilmStrip.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 85,
  },
  /* ── 体检清单 ⑨ 第三刀 · 错误信封（台账 E8）带出的三个 router ────────
   * 门槛取这批用例的实测值向下取整到 5；`workflow-model.ts` / `generate.ts`
   * 实测满档就登记满档（覆盖率只在**全量**这一档判，见 §11.7）。 */
  "src/components/studio/workspace-tabs.ts": {
    lines: 100,
    functions: 100,
    statements: 95,
    branches: 90,
  },
  /* 桌面实例的六个存储目录（只读展示）这一刀。按 §18.6 取**实测值**向下取整
   * 到 5 的倍数（只升不降）：
   *   · `src/lib/comfyui/desktop-storage-paths*.ts` 聚合实测
   *     99.13 / 86.04 / 90 / 97.43（纯解析 100 行全覆盖；`.server.ts` 的
   *     functions 77.77 是那组「一次读就抛 ENOENT 换下一个候选」的容错
   *     闭包，不是判决面）。缺口是没法自然构造的三态：yaml 列表项里带
   *     空串、`--x=` 空值后跟下一个 flag、以及 base 候选与实例根候选同时
   *     可读时的取值 —— 为它们造夹具等于给覆盖率买数字。
   *   · 设置页那两个出口（派生 + 纯展示组件）实测四项皆满，按实测设满档。
   * ⚠️ 路由组 `(main)` 的括号在 glob 里必须转义，否则条目静默不匹配。 */
  "src/app/\\(main\\)/settings/components/ComfyuiStoragePaths.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* ⑨ 第五刀 · 产物布局收口（台账 A8 第二段）这四个入口的实测下限
   * （数字来自「只跑这批用例」那一次测量，是**下限**，全量里只会更高）。
   * 三处刻意不是满档，没盖到什么点名如下（不写「还有一些没测」这种含糊话）：
   *   · `compose-steps.ts` 分支 65 —— 缺的是第 34 / 82 行
   *     `fixed(fadeOut, 2) ?? "0"` 与 `fixed(dur, 2) ?? "0"` 的右半边：
   *     `dur` 与 `fadeOut` 都由上层算成数字，实测构造不出 `null` 那个形状；
   *   · `bgm/route.ts` 行 95 —— 缺的是第 40 行 100MB 大小闸那一句：
   *     要造一个真 100MB 的 File 才盖得到，不值得为数字买那份内存与时长；
   *   · `media-source.server.ts` 只有 35/30/30/35 —— 本批只补了「本地产物地址」
   *     这一支的执行者（含那条 `path.sep` 边界的反向验证），`http(s)` 拉取与
   *     `resolveMediaDataUrl` 两族（第 58–121 行）仍**零执行者**，那是 E7 的账；
   *     登记低档是为了让「新增未覆盖」看得见，而不是把它藏进 workshop 的通配档里；
   *   · `firstframe.ts` 语句 95→100 / 分支 75→87（#4222 同批抬档）：补偿取消
   *     把等待失败三形（FAILED / 任务行消失 / cancel 自身失败）全部盖住，
   *     「上传回执无文件名」也补了用例；剩的一档分支是 `res.name === undefined`
   *     的 true 侧（mock 只回空串形态，再造一个 undefined 回执不值当）。 */
  "src/components/studio/canvas/use-custom-nodes-registry.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 台账 F13″ 这一刀的两个新出口（与上面 `coverage.include` 同批登记）。
   * 判据本体四维满档：27 条用例把「每一种脏法都要被点名」与「干净元素一条都不报」
   * 两头都钉住，另有一组与 `parseDraftDto` 的**配对**断言 —— 同一条脏元素既要
   * 还在原处（丢掉=静默删用户数据）、又要被报出来（继续不判=这处仍是洞），
   * 两边任何一边退化都红。
   * 出口那块**分支 87.5 实测 → 门槛 85**：没盖到的那一支是 `lines[0]?.tab ?? "script"`
   * 的右半边 —— 组件在 `issues` 为空时已经早退了，那一支按构造不可达。
   * 不为了凑数去 mock 一个「有问题但一条都组不出来」的输入形状：那测的是今天
   * 不存在的输入，数字好看而判据是空的（口径同台账 E8 那批 `if (!dir)` 的处置，
   * 也同 §18.6「门槛取实测、旧值与原因写在注释里」）。 */
  "src/components/workshop/DraftIntegrityHint.tsx": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 85,
  },
  /* ── 台账 E7 收尾：四档欠账的执行者（门槛按实测登记）───────────────────
   * 上面 `coverage.include` 里有 `"src/lib/**"`，所以这三条**不需要**再往
   * include 里补单文件条目（那一条 glob 已经把它们纳进报告了 —— 「两处同批」
   * 那条坑只在给 `src/app/**`、`src/components/**` 这类不在 glob 里的路径
   * 设单文件门槛时才会踩到）。
   *  · `log-file-client.ts` 四维满档：四个出口各自的失败语义 + 游标契约
   *    （`offset=0` 是真实值、首轮不带 `bootId`）；
   *  · `video-queue-client.ts` 从**全库唯一那个「0% 而有人在调」**抬到满档：
   *    它此前一行都没执行过，而消费方（视频队列弹窗）就在那儿显示占位图标；
   *    契约判据本体在 `tests/task-list-wire-contract.test.ts`（那份要 import
   *    真实 router，按 `lib → server` 那条判据不能住在 lib 里）；
   *  · `repository-task.ts` 分支 87.93 实测 → 门槛 87：没盖到的那几支是
   *    「行不存在 / 列缺值」的兜底（`rows[0] ?? null`、`extra` 不传），
   *    真机上由上面的仓储不变式保证不会发生 —— 不为了凑 100 去 mock 一种
   *    今天不存在的输入形状（口径同台账 E8 那批 `if (!dir)` 的处置）。 */
};
