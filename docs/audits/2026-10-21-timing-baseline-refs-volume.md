# 耗时基线复测：开发盘与 CI 搬到 ReFS 之后（2026-10-21）

> 机器 = `LAPTOP-45M82AAB`，16 逻辑核。检出 `G:\ComfyAPP\comfy-app-t3-branch2`、pnpm store
> `G:\.pnpm-store\v11`、runner `G:\runner\data\orange-ci`、缓存槽 `G:\ci-cache\comfy-app-t3`。
>
> **`G:` 是 ReFS**（卷标「开发」，100G）。旧那批读数时代的 `F:` 是 NTFS（卷标「数据」），
> 而**两卷在同一块物理盘**上（Disk 1 = WDC SN730 1TB NVMe；`C:` 在另一块 SL7000 2TB）。
> 所以本账里所有「倍率」都是**文件系统之间**的差，不掺硬件。
>
> ⚠️ 引用规则：下面每个数都带 ①盘/文件系统 ②冷态或暖态 ③当时有无并发 job。
> 缺任一项就按「不可引用」处理（与 `2026-10-16-hook-baseline-map.md` 那句「秒数是量级不是承诺值」同口径）。

## 一句话结论

搬盘没有把这条链变慢——**元数据密集的那一族反而快了 2–4×**。真正变的是两件事：
① 每日档被**两条与搬盘无关的在红**挡住（接槽×Turbopack、bundle-budget 棘轮），所以那几格的旧读数
如今连「当日唯一执行者」都没有了；② 冷态/暖态那一格的跨度**比文件系统差大得多**，
同一份「不接槽装依赖」在 25 分钟内是 216s → 88.5s → 48.8s，而 NTFS 的旧读数是 51s。

## 表 A：CI 每日档，同一台机同一份 master，两个臂

臂 A = 现役每日档（接槽），`cnb-5va-1k5d3fcen`（`api_trigger_daily`，10-21 00:40 本地）。
臂 B = 探针，逐字取 `.daily-gates` 原文、**只摘掉 `COMFY_CI_SLOT: "1"` 那一行**，
`cnb-qa3-1k5d59se5`（暖态那一次；同一份配置更早两次 = `cnb-2ef-1k5d41m2q`、`cnb-jvp-1k5d4m05n`）。

| stage                     | 臂 A（接槽）            | 臂 B（不接槽）           | 旧读数（F:/NTFS，非受控）              |
| ------------------------- | ----------------------- | ------------------------ | -------------------------------------- |
| `Prepare`                 | 30.4s                   | 17.3s                    | ≈31.5s（`.cnb.yml` 注释）              |
| `每日工具链自证`          | 14.6s                   | 5.4s                     | 13.8s（撤档时那条）                    |
| `每日安装依赖`            | **13.8s**（reuse 命中） | **48.8s 暖 / 88.5s / 216s 冷** | 普通装 `Done in 51s`、建槽 69.2s、命中 ≈2s |
| `每日 Python 可用性`      | 3.3s                    | 1.8s                     | 2.8s                                   |
| `每日 Python 探针读数`    | 3.8s                    | 1.9s                     | 3.0s                                   |
| `每日同步数据库表结构`    | 15.0s                   | 8.9s                     | —                                      |
| `每日生产构建`            | **13.8s 红**（见立案 1） | **121.3s 红**（见立案 2；`next build` 本体 ≈116s、产物 2590 文件判干净） | 118s（`cnb-eus-1k5058g8l`）/ 131.0s（`cnb-ln5-1k540cfn1`） |
| `每日 ESLint 零警告`      | skipped                 | **168.1s 绿**（独跑、暖） | 114s 本机热 / 311s 本机冷 / 256~274s 节点 |
| `每日浏览器安装`          | skipped                 | 1.7s                     | 首跑 2m12s / 二跑 1.1s                 |
| `每日全量E2E`             | skipped                 | **无读数**（前提是被摘掉的构建格） | 无历史读数（§13.5.3.10 那句话今天仍然成立） |
| `每日单元测试`            | skipped                 | **627.9s 墙钟，1 红**（`Test Files 1 failed / 788 passed (789)`、`Tests 1 failed / 10237 passed / 38 skipped`、vitest 自报 `Duration 619.34s`） | 827s（`cnb-eus-1k5058g8l`，755 文件全绿） |

三点判读：

- **文件系统不是慢因。** 臂 B 的每一格都不比旧读数差，多数还快；唯一"变慢"的 `安装依赖`
  在暖态是 48.8s，与 NTFS 的 51s 同档。
- **`预算表` 那四个 `timeout` 不必动**（`30m/45m/20m/30m`）。它们与实测之间还有 10–20 倍余量，
  而本仓口径是「判据只钉形状，秒数留在账本」——见 §13.5.3.10 末那两句。
- **臂 B 的两次红都不是「这台机跑不动」的形态**：一次死在依赖的装载方式（立案 1），
  一次死在体积棘轮的记账前提（立案 2）。单测那一格唯一一条红是断言失败而不是超时（立案 3），
  所以 §11.13 的 `testTimeout 30s / hookTimeout 45s / maxWorkers 8` 三档**没有证据要改**。

## 表 B：CI PR 档逐格（搬盘当天 31 条 job，接槽；独跑 = 窗口内无并发 job）

| 那一格（脚本）                       | 中位    | 独跑中位 | min→max        | n  |
| ------------------------------------ | ------- | -------- | -------------- | -- |
| `ci-affected-tests.mjs`（受影响用例） | 159.6s  | 143.2s   | 97.7→1023.5s   | 17 |
| `ci-heavy-gates.mjs`（重档静态判据）  | 48.7s   | 50.9s    | 37.1→93.9s     | 13 |
| `git init`+fetch+checkout（检出）     | 20.7s   | 21.2s    | 15.3→34.5s     | 31 |
| `tsc --noEmit`（类型检查）            | 14.9s   | 14.9s    | 10.0→23.6s     | 17 |
| `check-pnpm-available.mjs`            | 12.4s   | 12.4s    | 6.8→180.9s     | 17 |
| `db-push.mjs`                         | 11.9s   | 11.9s    | 8.7→28.2s      | 17 |
| `check-file-structure.cjs`            | 5.1s    | 5.1s     | 2.5→5.9s       | 6  |
| `ci-workspace-provenance.mjs`         | 4.6s    | 4.6s     | 3.6→8.9s       | 13 |
| `ci-cache-slot.mjs`（读数档）         | 4.5s    | 4.5s     | 1.6→10.6s      | 17 |
| `ci-workspace-probe.mjs`              | 3.9s    | 3.9s     | 2.4→8.1s       | 17 |
| `check-branch-guard.cjs --pr-check`   | 3.3s    | 3.4s     | 2.1→7.7s       | 31 |
| `ci-env-probe.mjs` / `freshness-gate` | 3.0s / 2.8s | 3.2s / 2.8s | —          | 17 |
| `check-ui-logic-separation.cjs`       | 2.8s    | 3.1s     | 2.1→5.5s       | 13 |
| `ci-image-identity.mjs`               | 2.7s    | 2.7s     | 1.6→6.0s       | 17 |
| `check-changelog-fragments.cjs`       | 2.1s    | 2.3s     | 1.4→3.4s       | 13 |
| `check-ps1-consistency.mjs`           | 2.0s    | 2.0s     | 1.4→3.3s       | 8  |

读这张表要带着的两句话：**① `1023.5s` 那一档不是判据变慢**，是同机负载（`max` 与独跑中位差 7 倍，
`check-pnpm-available` 的 `180.9s` 同理）——所以这里**只有独跑列可以当量级引用**；
**② PR 档跑的是接槽形态**（`node_modules` 是指进槽的 junction），`tsc` 14.9s 这类读数与
「宿主 NTFS 冷跑 40.1s」那种量具**不同尺**，别拿来算倍率。

## 表 C：本地实测（同一份量具，两卷各跑一遍）

脚本 = 一份 Node 探针（`statSync` 全跟踪文件 / `create+unlink` 500 个文件 / `spawnSync node -e 0` 120 次），
两卷跑**同一份**、各自独立进程，避免 MSYS fork 冒充被测成本。空机（无 vitest/tsc 并发）。

| 量                       | G:（ReFS，branch2，5236 文件） | F:（NTFS，主检出，5237 文件） | 方向         |
| ------------------------ | ------------------------------ | ----------------------------- | ------------ |
| `stat` 暖                | **77.0 µs/文件**               | 296.7 µs/文件                 | ReFS 快 3.9× |
| `stat` 冷                | 104.5 µs/文件                  | 392.2 µs/文件                 | ReFS 快 3.8× |
| `create`（含写 2KB）     | 569.2 µs/文件                  | 1226.5 µs/文件                | ReFS 快 2.2× |
| `unlink`                 | 321.7 µs/文件                  | 570.7 µs/文件                 | ReFS 快 1.8× |
| 进程创建（`node -e 0`）  | 中位 108.4ms（min 91.5 / P90 149） | 中位 120.1ms（min 100.5 / P90 149.8） | 同档（与被测卷无关） |

四句限定：**①** 这份量具与 §13.5.3.4.1.5 那张 ext4/NTFS/9p 表**不是同一把尺**（那张的 NTFS `stat` 是
996.0µs/文件，量的是当时那棵树的一次冷遍历）——换量具即作废历史可比性，两栏不许直接相减；
**②** 两棵树是两个检出、HEAD 差几笔，文件数几乎相同（5236 vs 5237），差值远大于这个不对称；
**③** 先跑的那臂（G:）在冷侧，仍赢 3.8×，方向不是次序造成的；
**④** 进程创建那一行落点不在被测卷上（Node 二进制在 `D:`），它只证明「这台机起进程的成本没变」，
不能拿来解释任何一格墙钟。

另有四条本机单点：

- **本地钩子 D0 那一档 = 10.7s 与 7.8s 两笔**（本增量的真实绿提交**自记账**，取前两笔；
  取 `scripts/precommit-timing.mjs`，账本 `.git/comfy-precommit-timing.jsonl`，本机不入库）。
  旧盘那一笔是 **D0 组 16.1s / 步之和 15.4s**（§13.5.8.2.1）。方向是快，但**两条样本不构成新基线**——
  且这两笔都只动文档面（14 步里有两步因「未触及依赖面」早退）。
  最贵的三步（第一笔）：`故事面` 2.3s、`端口推导跨语言一致性` 1.6s、`UI/逻辑分离硬闸` 1.0s。
- `pnpm install --frozen-lockfile` **无改动快路** = pnpm 自报 `Done in 1.7s`（含 pnpm 启动的墙钟 3.3s）。
- 页面级运行时（`e2e/runtime-budget.spec.ts` 原口径：12 轮、弃前 4 轮取 min、dev 档 webServer）=
  **`loadEventEnd 740.1ms / FCP 372.0ms`**，对照 `scripts/.runtime-budget-baseline.json` 的
  win32 基线 716ms / 344ms ⇒ 一条 +3.4%、一条 +8.1%，仍在 ×2 预算内。**基线不改**（一条读数不足以
  重记基线，而那两份数的口径本来就写着「三次独立运行同值」——要重记就按同口径跑够三次）。
- `每日单元测试` 那一格的 627.9s 是**节点身份**（服务账号 + 全新作业目录）的读数，
  与本地检出暖树跑出来的墙钟不是一回事，别互相顶替。

## 立案（本 PR 只记不修）

1. **接槽 × Turbopack：`每日生产构建` 在 13.8s 处 FATAL**（臂 A）→ **ISSUE #2081**。
   `Symlink [project]/node_modules is invalid, it points out of the filesystem root`。
   成因形状：接槽把作业里的 `node_modules` 做成**指向项目根之外**的 junction（槽根由
   `pnpm store path` 推导 ⇒ `G:\ci-cache\comfy-app-t3\<key>`，作业在 `G:\runner\…\workspace`），
   而 `scripts/ci-slot-apply.mjs` 头注那句「接过去是干净的」**只验过 `tsc` 与 `vitest`**（第 1 条实测），
   从没验过 `next build`。臂 B（不接槽）过了 Turbopack 跑到 121.3s ⇒ **红归给接槽，不归给搬盘**。
   开关是 2026-10-20 拨的（#2049/#2051），而每日那一跑上一次执行是当天 04:00（拨开关之前）——
   所以这是这两格第一次组合，不是回归。
2. **`bundle-budget` 棘轮红 +543 B，且它的比对前提在 CI 上不成立**（臂 B）→ **ISSUE #2082**。
   `gzip 总量上升：2276.7 KB → 2277.2 KB`，同屏另一句是
   `基线修订号 0a618c1c 在本检出里不可达（基线过期 / 浅克隆）`——也就是它**无法判断**这批读数与
   基线之间源码动过几次，却仍然阻断。基线生成于 2026-10-17。
3. **`tests/git-dir.test.ts > 普通检出 → 仓库根下的 .git` 在节点身份上红**（臂 B 的单测格，唯一一条红）。
   `expected 'C:/Windows/Temp/git-dir-wYCMcU/repo/.git' to be 'C:/WINDOWS/TEMP/git-dir-wYCMcU/repo/.git'`
   —— 断言把 TEMP 的**大小写拼法**当成了事实，而那一项由执行身份决定。它不是超时形态，
   所以按 §11.13 定性为真红；但它红的是**环境拼法**，不是被测逻辑。

## 取数与复跑手法（这一轮真正可复用的三件）

- **逐格墙钟不用解析日志**：`cnb build get-build-status -v --repo <slug> --sn <sn>` 的
  `data.pipelinesStatus[<sn>-001].stages[]` 每项带 `name/status/duration`（毫秒）。终态集合里
  红是 `error`（不是 `failed`）。
- **节点原始读数在本地 stream-log**：`G:\runner\data\orange-ci\stream-log\<sn>-001.log`（JSONL）。
  ⚠️ 每条的 `runtime` 是**该 stage 自己起点以来**的毫秒、会反复归零：stage 时长取组内 `max(runtime)`，
  job 总时长取 `max(time)-min(time)`；`type:"cmd" && taskType:"user"` 那行是 runner **实际执行**的命令行原文。
  `time` 是 UTC，本地 +8。
- **免提交探针有两个必须先满足的前提**（这两条都是从红里读出来的，不是文档里推的）：
  内联 `--config` 的 YAML **必须带分支键那一层**（`master:` → `api_trigger:` → 流水线数组）；
  只写 `api_trigger:` 会得到 422 `CONFIG_EVENT_EMPTY … no api_trigger event config for branch master`，
  话术像「没配置」，其实少一层。第二，**探针要带自己的 `lock.key`**：照抄 `.common` 里那条
  `pr-$CNB_PULL_REQUEST_IID` 会在非 PR 事件上退化成 `pr-`，于是**任何一次 push 流水线都会把探针
  `cancel-in-progress` 掐掉**（实测 `cnb-ta7-1k5d5234e` 死在这里，尾格 `cancel`）。
  另有一条量具层的坑：把整份 `.cnb.yml`（54KB）当参数递给 `cnb` 垫片会 `Argument list too long`，
  剥掉注释后的 4.4KB 可以过。
