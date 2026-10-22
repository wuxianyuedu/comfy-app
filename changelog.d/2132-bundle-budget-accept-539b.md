## Changed

- **客户端体积棘轮抬一档：gzip 2277.2 KB → 2277.7 KB（+539 B），文件数 221 ⇄ 221**
  （ISSUE #2132；按规范 §13.5.4 例外流程 `pnpm run check:bundle --update --allow-increase`，
  before/after 两档读数、配对账与逐笔归因见
  `docs/audits/2026-10-21-timing-baseline-refs-volume.md` §5 与本 PR）。
  读数取自**完整产物链**那一档（`pnpm run build`：`next build` → 链接修复 → 私密输入减法 →
  数产物 → 本判据），不是单跑 `next build` —— §13.5.4 记过这两者的「新增」计数差一个量级。
- **为什么值这 539 B**：基线修订号之后 44 笔主干提交里**只有 3 笔动过 `src/`**，
  `pnpm-lock.yaml` 与 `next.config.js` 一笔没动（所以不是「拉进来一个新依赖」那一类）。
  那 3 笔里 `b2138660`（#2118）改的是 `src/app/api/**` 与 Node 宿主件 `lib/process/python-run.ts`
  —— 不进客户端图；剩下两笔（`f5f9e05e` #2123 的 `task-images-client.ts`、
  `32010475` #2140 的 `generate-payload.ts` + `workflow-generate-input.ts`）买的正是
  「客户端在运行时知道线上要什么形状」：台账 E4 那条线把两条 `as` cast 换成服务端与客户端
  **共用**的一份 schema，而「共用」在这里必然意味着它被打包进客户端。
  量级 0.024%，且没有多一次请求（文件数不变）。
- **539 B 全落在同一个块里**（`--update` 之前用另一把尺独立复算，两个量具同读数）：
  配对 `1gwk4_2404t7w.js` 31 250 B → `3gpd4ke-0618r.js` 31 789 B = **+539 B**；
  另一对 `23lm6v2wi7sjz.js` 877 B → `2zf-46-2phjlo.js` 877 B = **0 B** —— 那个块是动态加载清单，
  它只是把改名后的块名抄了一遍（块内第一行就写着 `static/chunks/3gpd4ke-0618r.js`）。
  两读相等是巧合，不是「清单块恒 0」（上一轮它是 +1 B）。
- **#2140 那一半钉得住、#2123 那一半沿用上一轮**（这条界线写出来，别让下一个人以为两块都复算过）：
  钉 #2140 用的是**两档读数之差** —— 同一份基线下 `aa2123c8` 报 +45 B、`a2afa733` 报 +539 B，
  而这两个 revision 之间只有一笔动过 `src/` ⇒ 增量 494 B 归它；块内证据是
  `workflow-generate-input.ts` 独有的两串中文（`缺少要执行的工作流` /
  `这条记录的入参与当前形状不符`）在 221 个块里只出现在那一个新块。
  #2123 那一半**本轮没有复算块内证据**：`isCover` / `localPath` 这类列名在别的客户端模块里也有，
  不足以单独把它钉进这一块 —— 沿用 #2132 与 §13.5.4 里上一轮的定位。
- 新基线锚点落 `a2afa733`（主干可达那一枚，规则由 #2082 立下）；重跑 `pnpm run check:bundle` 绿。
