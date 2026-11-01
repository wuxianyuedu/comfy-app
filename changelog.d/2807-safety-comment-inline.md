## Changed

- **oxlint `anti-slop(require-safety-comment-for-type-assertion)` 的同行形态全仓归零**（ISSUE #2807，
  接 #2774 / #2699）：`/* SAFETY: … */ (v as T)` 这类「注释与断言挤在同一行」的写法共 **1386 处**，统一改成
  注释**独占一行、紧贴包含断言的那条语句之前**。为什么这是必须改位置而不是改措辞：这一格只认「注释独占一行、
  且压在**包含断言的语句**上」—— 同行形态对它是**无效注释**，规则一扩面就会整片红。判据的**执行者**在这里是
  一个只读探针（把规则自己的 `getCommentsBefore` 语义照抄成插件跑一遍），不是新门禁：本次没用任何新判据，
  改完拿真规则复核，全仓 0 命中。
- 结构上不是纯文本替换：约 **1/3 的位置**注释上移会改变语义（`if (…)` 的条件、三元分支、`?.`/`??` 的右操作数、
  实参列表中间、对象字面量属性值），这些位置一律把断言**提成具名 `const`** 再压注释（只改注释位置，不改求值），
  或把判定抽成类型谓词（`isWorkflowRunMeta` / `hasStringMessage` / `hasStringStack` / `isOutputFileEntry` /
  `isByRecord` 一族）。剩余 **46 处**形态在原位无法表达（模板字符串插值、`require` 后紧跟断言、`value: [ … ]`
  这类跨行容器），按「注释上移一行、断言原样」处理 —— 它们不是本次的目标形态，留待规则扩面那一批再看。
- 零行为变更：`tsc --noEmit` 绿、`eslint --max-warnings 0` 绿、`vitest run src/…` 552 文件 6600 条全绿。

- **CI 现场收口：6 处判据写死了「Windows 盘符」，在 Linux 节点上恒红**（PR #2991 的
  `受影响用例` 一格）。症状是 5 条 assert，全都长成「卷根判不出来」：`dev-drive-tune` 的
  `volumeRootOf(G:\a, "win32")` 拿到 `/`、`ci-cache-slot` / `ci-build-cache-slot` 的推导
  答「问不出 store」、`publish-desktop-bundle` / `tauri-tools-cache` 的根 `null`、
  `ci-slot-apply` 的 `statfsFreeBytes("Z:/…")` 反而读到了本卷。
  根因是同一个：`path.parse` / `path.resolve` / `fs.statfsSync` **只认宿主平台**，而这几条
  判据把 `F:` / `G:` / `Z:` 这类盘符当输入 —— 在 POSIX 宿主上它们被当成**相对路径**，
  于是「跨卷」永远判不出来、「不存在的盘」永远会是本卷。一处实现在
  `scripts/dev-drive-probe.mjs`（`volumeRootOf` 的 `resolve` 该走 `path.win32.resolve`，
  否则拿到的是 `<cwd>` 拼出来的 POSIX 绝对路径），其余按「判的是因果、不是盘符长什么样」
  改判据：卷根一律由 `path.parse(ROOT).root` 现取，「所有卷都读不到」用 `statfsSync` 的
  ENOENT 桩替身那台机器。**没有放宽任何一条判据**：平台的两种形态各自都仍然判得出来。
