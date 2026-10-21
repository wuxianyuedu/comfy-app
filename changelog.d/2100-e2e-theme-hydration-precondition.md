## Fixed

- **`e2e/theme-token-consumers.spec.ts` 的整档红（ISSUE #2100，每日档首跑照出来的那条）**：
  用例用手写 `classList.toggle("dark", …)` 拨主题、**立刻**读 `getComputedStyle`，
  而 `src/app/ThemeProvider.tsx` 是 `attribute="class"` + **`defaultTheme="dark"`** +
  `enableSystem={false}` —— `applyTheme` 跑在挂载效果里。`beforeEach` 当时只等到
  `domcontentloaded`，于是拨动可以发生在落地之前、class 随后被 provider 改回 dark。
  症状因此是 **α 对、色相错**：light 档读到 dark 那颗 slate-400
  （`expected [0,0,0], received [148,163,184]`），且**只在整档里稳定复现**
  （前一格把 `/login` 那条路由焐热 ⇒ 落地落点前移）、单跑该文件反而绿，
  `--workers=1` 严格串行仍红 ⇒ 不是并行争用，是**前提坏**（§11.13 那句「换个跑法就换结果」的又一型）。
  - 两条一起改：**`goto` 用默认的 `load`**（同文件那条「二次代入」早就立过这条口径 ——
    `load` 才是这条用户路径成立的前提），以及**拨完 poll 一次「`<html>` 确实在目标档」**。
    第二句是重点：**「我拨过了」不等于「页面在这档」**；缺它，竞争不会消失，
    只会把红挪到一条看不懂的消息上（此前正是如此 —— 报的是色相，坏的是时机）。
  - ⚠️ 反面教训一条留在 §11.13：**别拿 `reload` 当「让框架自己落地」的解法**。
    中途真走过那条（写 `localStorage.theme` + reload），结果在同文件「二次代入」那条上
    把**用例自己搭的前提**拆了（要先「建项目 → 开画布」才有可测的 DOM），
    红从「色相取错」变成 `解析不出颜色：none` —— 画布没了，不是 token 落空。
  - 读数：最小复现（`theme-toggle` + 本文件两格同跑）由 `1 failed / 7 passed` 变 **`8 passed`**（13.9s）；
    整档 `COMFY_E2E_SERVER=start node scripts/e2e-run.mjs` ⇒ **`81 passed`（1.5m）**，
    随本增量一起登记 `scripts/.e2e-freshness.json`（那一档「上次跑绿在什么时候」的唯一事实）。
    旧整档读数：CI `每日全量E2E` 100.0s `1 failed / 80 passed`、本地同档 `1.3m` 同形 —— 见账页 表 D。
  - 同形隐患**未在本刀内改**：`e2e/view-tabs.spec.ts:147-151` 是同一句手写 `classList` 且不验状态。
    它现在是绿的，把一条 lucky-green 改成会红不属于本增量（§11.13 ②「不由本刀顺手改它的构造」），
    已记在 #2100 的收口评论里交给那条线。
