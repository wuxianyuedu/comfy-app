## Fixed

- **应用内补上「查看已归档日志」的入口**（ISSUE #1587，用户原话：「日志会归档到 runs 中，但应用内缺少入口查看这些归档日志」）：`/api/logs/sessions` 此前只列 `log/current/services/` 下该来源的份，**应用退出归档之后那一包里的份没有任何界面能打开** —— 用户只能自己去文件管理器里翻 `log/runs/`。现在该端点把两处一起列出来交给设置页「启动日志」的下拉：本次运行的份恒在最前，其后是各历史运行包里的份（包名倒序），归档项的文案带 `时刻 · 正常/异常退出 · runId`，切过去读到的是**那一包那一份整份**。

  - **一条减法都没加回来**：跨包这一层的判据与 IO 是 `#1550` 落的（`log-run-packs.ts` 纯判据 + `log-run-packs.server.ts` 的 IO），但那次的端点仍只列 `current/` —— 能力落了一半，而**没有任何判据会喊**（两侧各自都「看起来是对的」）。本刀只做接线：端点把 `listRuntimeLogFiles()` 与 `scanRunPacks()` 的结果递进 `buildRunScopedOptions()`，归档份按 `<包名>/<文件名>` 进包定位。归档是整目录复制 ⇒ 包内结构与 `current/` 逐字同构 ⇒ 复用「文件是谁」这条判据，`runSlice` / `baselineMissing` 那套长度减法一个都没复活。

- **契约补两个字段**（`LogSessionMeta` 的 `scope` / `crashed`）：`scope` 回答「这一份属于正在写的本次运行，还是已归档的某次运行」，`crashed` 回答「那次是不是崩了」—— 两者都是端点在拼列表时已经知道、而视图此前无从判断的信息。文案三段（含 runId）仍由 `lib/log/log-run-packs` 一处拼好，视图只渲染，不自己格式化。

- **架构跟随**：列表方向（`sessions` 新→旧、缺省选 `sessions[0]`）与跨包顺序只在契约和纯判据里各定义一次；归档 id `<包名>/<文件名>` 由视图层**原样回传**，形态判据只在服务端一处（`parsePackScopedId`），畸形 / 穿越形态一律回落最新那一份、不拿去拼路径。

## Tests

- **与 `master` 的合并面**（本 PR 与 `origin/master` 在同一批视图文件上交叠，解冲突时的取舍在此记账）：
  - `task.list` 契约：两侧对同一件事各写了一份 —— 本 PR 给 `videoPath` 补 `mediaType === "video"`
    那一档（落盘名不带视频扩展名、但产物子表记了它是视频），`master` 给了这份镜像反向核对它的
    判据 `tests/task-list-wire-contract.test.ts`。两者都留：`videoPath` 的判据取两侧并集，
    `videoTaskRowSchema` 的 `type` / `status` 去掉 `.default(...)`（镜像里**有默认值**的列，
    反向核对看不出线上少发它 —— 这正是那份判据要拦的形态），`VideoTask` 的 `video` / `error`
    由可选改回必填（`parseVideoRows` 恒给 `null`，可选是假承诺）。
  - 五处视图文件的 a11y 收口（`MessageCenterPanel` / `HistoryTaskCard` / `DebugChainFooter` /
    `multi-mode-select` / `AttributeMultiSelect`）：双方案子在**同一个判据**（06 §6.11）下收敛
    —— 取 `master` 的结构（`li > div > 两个按钮` / `role="checkbox"` 行 / `<h3>` 收口），
    把本 PR 那几段注释里的理由并进去，两边各留一份 `simpleKeyHandler` 的那两条注释收敛成一份。
  - `.githooks/pre-commit` 与 `13-提交与-code-review.md`：本 PR 接的两条判据（`check-click-keyboard` /
    `check-deps-freshness`）与 `master` 接的三条（多一条 `check-a11y-rules`）按判据去重，
    D 组 52 步（钩子注释里那个计数由 `tests/doc-check-hook-wiring.test.ts` 逐字核对）；
    `docs/generated/13-…` 是渲染产物，随源重生成而不手改。
  - 三份队列用例的夹具在两侧合并后出现**同一属性指定两次**（`videoPath`，tsc 报 TS1117）：
    重复行删掉，判据是 `scripts/check-ts-duplicate-keys.cjs`（已跑）。

- `src/app/api/logs/sessions/route.test.ts`（23 例，跨包组新增 10 例）：列表 = 本次运行 + 各历史包（新→旧、`scope` / `crashed` 如实带出）、切到归档份拿到的**是那一包那一份**（反向断言不含本次运行的内容）、两个包同名份各读各的、崩溃包标「异常退出」、没有该来源份的包不列、本次运行恒在最前（即使历史包时刻更晚）、`runs/` 不存在只有本次运行、本次运行的份被清空后退化成纯历史视图、畸形 / 穿越 id 一律回落最新、`.zip` 包不列。夹具造的是**真目录结构**（`makePack` 按归档形态造 `services/` + `run.json`）。
- `src/app/(main)/settings/hooks/use-settings-page.test.ts`（+1 例）：切到归档份时 id **原样**带上（`<包名>/<文件名>`，不被拆成文件名、也不被拼上路径）。
- 反向验证过：把端点里的 `packs` 换成空数组，跨包组 6 条立刻报红。
- 夹具订正：`RuntimeLogBox.test.tsx` 与 `use-settings-page.test.ts` 的会话夹具按**契约**补 `scope` / `crashed`，并去掉早已不存在的 `▶ 启动会话` 旧文案（那是横幅时代的口径，横幅写侧已整条撤掉）。
