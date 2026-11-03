## Added

- 新入口 `pnpm check:mirror-attendance`（#3046，双远端这条线的「在册 ≠ 出勤」那一半）：
  问的是「GitHub 那一侧到底收到过没有」—— 窗口内（默认 24h）PR 那些跑里，主列那一格
  `GitHub 镜像同步` 有没有至少一次「已推 · 已派发」。此前这句话**没有只读出口**：镜像仓是私有的
  （匿名 `GET /repos/wuxianyuedu/comfy-app` = 404），唯一证据躺在 cnb 那一格的日志正文里，
  每次都要人手工翻（#3047 之前连格名都点不到）。
- ⚠️ 它认的是**正文里的三态原值，不是格状态** —— 这是 #3051 换来的一个必然后果：那一格现在是
  主列的读数档（`--readout` 恒不退非零），所以推送失败的那一跑格子上照写 `status=success`
  （实测 `cnb-vj3-1k6ddf69d`：正文 `推送失败（exit 128）：schannel: server closed abruptly`）。
  拿 status 判出勤会把「推不通」念成「天天出勤」。
- 失败形状分**七类**、各有自己的下一动作，不许念成同一句（#3046 的现场就是 TCP 连不上被念成
  「令牌活不活」，人就当真去查令牌）：`egress` / `repo-missing` / `token-scope` /
  `push-failed` / `dispatch-rejected` / `missing-prereq` / `no-cell`（这一跑没这一格 ⇒
  前移未生效或不是 PR 档，**不算缺勤**）/ `unreadable`（格子找到而正文取不到 ⇒ 也不是
  「它没跑」的证据）。三态退码与「取数没盖住窗口就不判」逐字沿用 `check-daily-attendance.mjs`
  （#2392 那条口径）；逐格判定与取数全部复用 `ci-build-readout.mjs` 那一份，不写第二份。
- 登记四处（按需档的既有形态）：`package.json` 的 `check:mirror-attendance`、
  `quality-gate.mjs` 的 `GATES.mirrorAttendance`（`run: false`）、
  `scripts/.on-demand-duties.json` 的 `mirror-attendance` 行、
  `scripts/.gate-thresholds.json` 的两笔承重量（`DEFAULT_WINDOW_HOURS` = 24 小时 /
  `DEFAULT_DETAIL_LIMIT` = 8 跑 —— 「判据自身的数值 ⇄ 账同批」那条 D0 判据会把没入账的数值拦下）；
  同批补 §13.5.4 的按需档表格行与「在册 ≠ 出勤」同族那一节，并带上 `docs/generated` 镜像。
- 第一次真读数**当场抓出自己的一条假缺勤**（这条比入口本身更值得记）：默认 `--limit 3` 那一跑念
  `缺勤 ✗ 窗口 48h 内 2 跑有这一格、零次推成（egress×1、push-failed×1、no-cell×1）`
  （覆盖自证「8 页 / 480 条 · 最早 2026-10-30T15:30:03Z」），而把面放宽到 4 跑就撞到
  `cnb-8uu-1k6dbf7oc` 的「已推 · 已派发」—— 那句「零次推成」是**取数面比结论窄**造出来的
  （#2392 那一族在一个新入口上复发）。于是默认放到 8 跑，并把 headline 的主语从「窗口内」改成
  「最近读的 N 跑」+ 明写「未逐跑读 M 跑」。当前默认读数（24h、读 8 跑、退 **0**）：
  `出勤 ✓ 最近读的 8 跑里 1/6 跑「已推 · 已派发」（最近：cnb-8uu-1k6dbf7oc）· 窗口 24h 内共 189 跑`，
  形状分布 `egress×1 / push-failed×3 / token-scope×1 / no-cell×2` —— 通道**至少真通过过一次**、
  失败是间歇的（断点在写那一跳的 Schannel 或更早的出网层）；而「摘格去 GitHub」的前置仍不成立，
  `COMFYAPP_CI_GATES` 里的名字照旧一个不许摘（业主口径 2026-11-02）。
- 复算：`tsc --noEmit` 0；新增/改动的三份（entry + `quality-gate.mjs` + 用例）eslint 0；
  39 条已清零规则集全仓复扫（2423 份、`--type-aware`）0 命中；新用例 12 条全绿 ——
  其中一条**当场抓出重构残留的 `ReferenceError: base is not defined`**（缺勤那一支在把
  `counts` 换成 `stats` 时漏改一处，而在线那一跑恰好走的就是这一支）；两条断言各用现场变异
  打过红（成功那句去掉「已派发」那一半 ⇒ 反控制红；`no-cell` 不再被剔除 ⇒ 「整批没这一格」
  从 2 掉成 1 而红），验完已逐字还原；两件台账判据当场跑过：`check-on-demand-duties.cjs` ✓
  （11 行双向核对）、`check-gate-executors.cjs` ✓（89 份判据脚本、判定型有执行者 84）。
  基础设施那批 7 份用例共 149 条：第一跑红了一条 —— `on-demand-duties-gate` 的**夹具索引要跟着
  真 `quality-gate.mjs` 的 `run: false` 注册表长**，少登记 `mirror-attendance` 那一行，方向②
  （机器事实没被登记）就把这条判据自己念成红；补上之后 149 条全绿。
