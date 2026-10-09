## Fixed

- **`bdabd26f` 用 `--no-verify` 合入时，把 `d5ef0993` 的整片修复退了回去，master 从此卡着三道硬闸 —— 就地修回来。这条不是本 PR 引入的，但硬闸堵着所有人的提交**（§13.6.2「挡路的就地修掉」）。复算证据：在干净 `origin/master`（`61ca45f9`）的 `git worktree` 上跑，`check-click-keyboard.cjs` 同样报 4 处、`tsc --noEmit` 同样 3 条错、`check-docs-api.cjs` 同样报 `docs/api/**` 落后；`node scripts/base-check.mjs node scripts/check-click-keyboard.cjs` 判 **`baseline-red`**。
  - **成因**：`d5ef0993`（收掉两处别线的硬红）已把「鼠标点得开、键盘点不开」的 4 处站点改成原生 `<Button>` / `simpleKeyHandler`，并补齐了 `#1579` 掉在合并缝里的服务端投影与客户端 zod 镜像。随后 `bdabd26f`（#1581，在 `d5ef0993` **之前**分叉）合并 `origin/master` 时，两侧都动过同一段，合并结果**取了它自己那一侧**（`<li onClick>` + eslint-disable 豁免注释），把 `d5ef0993` 的结果覆盖掉；而它又亲手把 `check-click-keyboard.cjs` 补回 D 组 —— **判据回来了、它守的代码却被退回了**，于是 master 上这条硬闸恒红。该次提交带 `--no-verify`，没有人看见。
  - **还原清单**（逐文件比对 `d5ef0993` 的版本，只还原被退回的部分，`bdabd26f` 自己的合法改动一律保留）：
    - 4 处键盘可达站点：`MessageCenterPanel`（消息行→原生 `<Button>`，删除按钮作为兄弟节点不嵌套）、`HistoryTaskCard`（主体块→原生 `<Button>`）、`DebugChainFooter`（源码药丸→`<Button>`）、`MultiModeSelect`（`role="checkbox"` 行补 `simpleKeyHandler`）。
    - `#1579` 的契约半边：`src/server/api/routers/task.ts` 补 `videoPath` 投影、`src/lib/media/video-queue-client.ts` 改成 zod 镜像 + `parseVideoRows`（缺 `videoPath` 的行**整行判掉**、不补兜底）、`history-panel-client.ts` 导出 `historyTaskRowSchema` 给判据读，队列三份夹具按契约补 `videoPath: null`。
  - **保留的两处**：`DebugChainFooter` 里那对 `stopPropagation` / `preventDefault` 守卫的 `eslint-disable`（那是**守卫不是交互**，`bdabd26f` 加的、`d5ef0993` 没有）；`MultiModeSelect` 选项行的 `eslint-disable`（键出口是 `{...simpleKeyHandler(…)}` 的**属性展开**，`jsx-a11y/click-events-have-key-events` 只读字面量 `onKeyDown`，规则认不出 —— 豁免已在 `.a11y-rule-ledger.json` 的 `inlineExemptions` 登记，守它的是 `check-click-keyboard.cjs`）。
- **`theme-tokens.css-theme-surface.txt` 快照补上 `--gradient-brand`**（另一条挡路的基线红，同样不是本 PR 引入）。`#1558` 把品牌渐变收成 `--gradient-brand` 写进 `globals.css`，但没有同批更新这份文件快照，而这条用例在 group C 的固定清单里 —— 从 `#1558` 合入那天起它**拦住每一个提交**。复算确认后按「挡路的就地修掉」处置：`@theme` 里确实声明了这颗 token，快照落后于事实 ⇒ 用 `vitest -u` 让快照与源对齐，**改的是快照、不是判据**；不登记 `KNOWN_FAILED_FILES`（那份台账是终态空数组，且这条红有 trivial 的修法）。
- **`docs/api/**` 随之重生成**（`pnpm docs`）。它此前**在 master 上就已经不一致**：`tsc` 恒红 ⇒ typedoc 被同一批错误挡住 ⇒ 而 `docs/api/**` 是提交进 git 的判据产物，等于所有人的 API 文档同步都在停摆（`check-docs-api.cjs` 报「落后 12 / 多余 1」）。源码还原后重生成即对齐（2484 个文件），其中含一直被挂在产物里的 `lib_media_video-queue-client.VideoTaskRow.html`（源里那个类型已改名为 `videoTaskRowSchema`）。

## 验证

- `check-click-keyboard.cjs`：4 处 → **0 处**（基线 0）；`check-a11y-rules.cjs` 30/32 生效 + 方言 2 + 就地豁免 12，三向一致。
- `tsc --noEmit`：3 条错 → **0 错**；`eslint` 零警告。
- 全量 `pnpm exec vitest run`：**642 文件 / 7934 用例全绿**（修前 13 条红 —— `task-list-wire-contract` 9 + `MessageCenterPanel` / `HistoryTaskCard` 键盘可达 4，全部随还原转绿）。
- `check-docs-api.cjs --staged` 绿（2484 个文件与源一致）。
