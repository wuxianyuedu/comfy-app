## Added

- **「被门禁拦下先复算 master 基线」有了执行者**（ISSUE #1569）：`node scripts/base-check.mjs <拦住你的那条>`（整条命令 / 钩子标签 / 裸脚本名都认；`--fetch` 先拉、`--json` 给机器可读、`--keep` 保留临时 worktree 人工排查）。规范 §13.6.2 把处置口径写得很清楚，但那段 `git worktree add ../.wt-base-check … && node scripts/check-*.cjs … && git worktree remove` **只写在文档与注释里**，于是 §13.6.2 的末句一直是「这一条本身还没有机器判据」。
  - **四态，各对应一个明确动作**：`baseline-red`（干净基线上同样命中 ⇒ 别线的红）/ `yours`（基线绿、你的红 ⇒ 你的改动）/ `current-green`（无从复算）/ `inconclusive`（**没跑起来，不构成证据**）。
  - **`inconclusive` 是本刀实测踩出来的边界**：基线 worktree 是一个**干净的上游快照**，看不到本检出的未提交文件；那条路径下 Node 的 `MODULE_NOT_FOUND` 退出码是 **1**，与「判据跑了且红」逐字同形 —— 只读退出码必然误判。所以「跑不起来」由**目标存不存在**判（`commandTargetState`），不由退出码判。
  - **刻意不做**：不 `git fetch`（网络是人的动作）、不替你决定「挡不挡路」、不自动登记 `KNOWN_FAILED_FILES`、不自动改判据 —— 那是判断，判据只保证**事实**这一半可复算。临时 worktree 建在系统临时目录、跑完即删。
  - 契约测试 `tests/base-check.test.ts`（21 条）在**真 git 仓库**上跑（裸远端 + 跟踪分支 + `--detach` worktree）：四态两向各一组、命令解析四种写法、127 那条边界、`upstream 取不到`时判失败而不是静默拿一个错的基；进 C 组固定清单。
  - 入口：`pnpm check:base`；`AGENTS.md` 的「快速排障」与 §13.6.2 同步改掉旧的手搓命令。

## Added

- **「不进钩子」的按需档 ⇄ 执行者索引机器化**（ISSUE #1569，规范 §13.5.4）：`scripts/.on-demand-duties.json` + `scripts/check-on-demand-duties.cjs`（pre-commit 的 D 组「按需档 ⇄ 执行者索引」）。
  - **立案现场**：判据「不进钩子」是**代价判据**（起 webServer / 十分钟量级 / 网络请求），它**不回答「那谁在什么时候跑它」**；上一轮把五条都补上了执行者，但补的是**散文** —— 写进文档的表格不会自己响，于是下一个洞的形状很明确：**新增一个新鲜度档却忘了在 §13.5.4 登记 ⇒ 那一档谁都不判**（判据的覆盖面与它自称的不符，正是 §13.5.12 的立案现场）。
  - **双向核对**：① 每一行点名的机器事实仍然存在（档被删 / 改名 / 已接进 `check:all` ⇒ 过期承诺）；② 每一个机器事实都被本索引登记。事实**从既有出处现算**、不抄第二份清单：新鲜度档键取 `FRESHNESS_TRACKS`、「不进 `all`」取 `quality-gate.mjs` 的 `run: false`、按需召唤条目取 `.gate-executor-ledger.json`。
  - **判据自己不许静默降级**：索引不存在 / 非法 JSON / `duties` 为空 / 行数低于地板 / 缺字段，都判失败而不是「没有档要查、于是放过」。
  - 契约测试 `tests/on-demand-duties-gate.test.ts`（11 条）走共享夹具 `defineGateRepo`（§11.16.1），双向 + 静默降级各一组；进 C 组固定清单，并登记进 §11.23 的「声明 ⇄ 读者」索引（16 行）。
