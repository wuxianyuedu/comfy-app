## Fixed

- **日志面板两条 E2E 判据不再「量在状态落定之前」**（ISSUE #1267 顺带清账）。
  `e2e/critical-flows.spec.ts` 里两条 `@critical` 在默认并发下必红（串行也可能红），
  两条都是**判据读得太早**，不是产品坏了：

  1. 「下拉弹层贴住扳机底边，候选点得动」报 `hitAllInPopup: false`。base-ui 的定位层
     （`div.z-popup`）与弹层本体**同矩形叠放**，而弹层本体比它唯一的子节点宽 2px
     （实测 444 vs 442）—— 右侧/底部最外那几像素是弹层自身的空白，`elementFromPoint`
     在那里命中的是**上一层**的定位层，`closest('[data-slot="select-content"]')` 于是
     找不到弹层子树。用例原先取「向内缩 4px」，正好落进这圈空白。
     取点内缩改为 6px（落进内容区）。
  2. 「无文件来源的日志有『控制台 / 全局错误』分类」报
     `Expected: 901, Received: 1346`。两个数字（下拉读 `countsByOrigin.all`、页脚读
     `counts.all`）来自同一次 `derive()`，在任何**同一瞬**必然相等；先后两次读之间
     轮询（`POLL_MS = 2000`）还在往时间线追加，于是各自落在不同的时间线上。
     改为**同一个浏览器回合里读**（一次 `evaluate`）再用 `expect.poll` 判相等 ——
     判的是「同一瞬相等」，而不是「先后两次读相等」。

  两条都新增了 `settleBox()` 那种「等几何/状态落定」的读法，而不是
  `waitForTimeout(固定值)`：后者在慢机器上照样量早、在快机器上白等。弹层入场动画
  实测约 280ms 才落定（`boundingBox()` 不认 CSS transition，补间期间量到的是被
  `scale(.95)` 缩过的矩形：439.6×249 vs 444×251.5）。

  **两条判据都没被修瞎**，各做过负向验证：
  · 把定位层层级临时降成 `z-1`（弹层被面板遮罩压住、指针事件全被接走）→ 第 1 条依旧红；
  · 在 `log-store` 的 `computeCounts` 上注入 `all + 7` 的偏移（制造真实口径分歧）→ 第 2 条依旧红。
  还原后全绿，`pnpm exec playwright test e2e/critical-flows.spec.ts` 连跑 3 次 26 passed。
