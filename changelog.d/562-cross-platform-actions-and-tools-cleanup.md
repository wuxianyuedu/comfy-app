## Added

- **日常动作都有了跨平台入口，不再只有 Windows 双击这一条路（ISSUE #562）**：
  质量门禁、只跑测试、生成原文文档这三个高频动作此前只有 `.ps1` 实现在 `tools/`
  下，Linux / macOS / CI 上只能自己拼 `pnpm` 长口令 —— 而口令写在文档里就必然有人
  漏跑一步（例如忘了排除已知基线失败，于是同一套用例在两个平台给出不同的红绿）。
  现在它们各有 `.mjs` 实现与一条 `pnpm` 脚本：`pnpm check:all`（= `verify-quality.ps1`）、
  `pnpm test:file` / `pnpm test:full`（= `run-tests.ps1`）、`pnpm doc:gen`
  （= `generate-docs.ps1`），与 Windows 侧同契约同产出。
- **跨平台动作对照表与它的门禁（规范 §9.5）**：`.ps1` 与 `.mjs` 两侧的动作登记在
  `launch-and-build.md` §9.5 一张表里，由 `scripts/check-ps1-consistency.mjs` 在
  pre-commit 与 CI 核对「每个动作两侧脚本都真实存在」—— 新增动作只写一侧会被拦下，
  而不是等用户在另一个平台上发现「文档里那条命令不存在」。
- **`tools/` 的分类目录说明**：`start/`、`build/`、`docs/`、`registry/`、`studio/`、
  `scripts/` 各加一份 README（该目录有哪些入口、各自什么时候用、非 Windows 平台怎么办），
  `tools/README.md` 补「新增入口前先读」与跨平台对照，不再把清单堆在一个文件里。

## Changed

- **`KNOWN_FAILED_FILES`（已知基线失败清单）收敛到单一来源**：它原先定义在
  `scripts/quality-gate.ps1` 里、由 `scripts/run-tests.ps1` 用正则解析 `.ps1` 源码 ——
  等于把另一门语言的源码当数据源，改一次写法就会静默返回空数组，而「排除项悄悄为空」
  看起来就像「本来就没有基线失败」（红/绿不再可归因）。现移到纯数据模块
  `scripts/quality-gate-shared.mjs`，PowerShell 与 Node 两侧都读它。

## Removed

- **`scripts/dev-launcher.legacy.ps1`（1324 行的历史编排实现）**：文件头写着「只作对照，
  不要当主路径」，但留着它就等于邀请下一个人去改它 —— 一份不能执行、却看起来可以执行
  的 1324 行实现，是「改了不生效」这类排查事故的温床。编排的唯一实现是
  `scripts/dev-launcher.mjs`，需要回溯旧实现用 git 历史。
