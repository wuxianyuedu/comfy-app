# 拉取更新后：本地环境同步指南

> 适用对象：所有在本地跑过本项目的人（开发人员 / 非开发人员通用）。
> 回答一个常见问题：**远端提交改了 pnpm 相关配置，我本地 `git pull` 之后还要做什么？**

---

## 1. 为什么要做这一步

从 2026-09 起，本仓库把 pnpm 的项目级配置迁移到了 `pnpm-workspace.yaml`
（详见 `docs/standards/launch-and-build.md` §6「工具链钉死项」），关键配置包括：

| 配置 | 作用 |
|---|---|
| `minimumReleaseAge: 0` | 关闭 pnpm 默认的「新包 24h 拒装」供应链门槛 |
| `verifyDepsBeforeRun: false` | 关闭 pnpm 命令前的隐式自动 `pnpm install` |
| `allowBuilds` | 显式批准含 postinstall 构建脚本的依赖（如 better-sqlite3、esbuild、msw） |
| `package.json` → `packageManager: pnpm@12.4.1` | 钉死 pnpm 版本（由 corepack 管理） |

这些配置**只影响新执行的 `pnpm install`**，不会自动作用到已装好的 `node_modules`。
所以本地拉取到这类提交后，需要按下面的步骤让依赖环境与仓库配置对齐。

---

## 2. 标准操作（开发人员 / 熟悉命令行者）

```powershell
# 1) 拉取最新代码
git pull

# 2) 在项目根目录重新安装依赖（会读取最新的 pnpm-workspace.yaml 与 lockfile）
#    动手前先问一句「本检出的应用服务在不在跑」——在跑时原生模块被进程锁住，
#    install 会以 EPERM 连锁失败并拖垮后续每一条 pnpm 命令（AGENTS 硬规则 9）。
#    这一问已经有执行者，不用靠人记：pnpm deps:guard 判到即停。
pnpm deps:guard && pnpm install

# 3) 验证
pnpm exec tsc --noEmit   # 或直接 pnpm dev 跑起来看是否正常
```

### 什么时候需要更彻底的重装？

出现以下情况之一时，先删再装（清掉旧配置下生成的 node_modules）：

- `pnpm install` 报 `ERR_PNPM_IGNORED_BUILDS` 或 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`；
- `pnpm-workspace.yaml` 里的 `allowBuilds` / `minimumReleaseAge` / `verifyDepsBeforeRun` 有变更（提交信息里通常会提到）；
- better-sqlite3 等原生模块运行时报错（旧二进制与新配置不匹配）；
- 上一次 install 被中断过，`node_modules` 可能残缺。

```powershell
# Windows PowerShell（项目根目录执行）
Remove-Item -Recurse -Force node_modules
pnpm install
```

### pnpm 版本不对怎么办

本仓库钉死 `pnpm@12.4.1`。若 `pnpm -v` 版本不一致或命令报错，用 Node 自带的
corepack 对齐（corepack 会读取 `package.json` 的 `packageManager` 字段自动切换）：

> **启动器已自动处理**：从 2026-09 起，`tools/start/start-tauri.ps1`、`tools/start/start-tauri-dev.ps1`、`tools/start/start-web.ps1`、`tools/start/run-local.ps1` 启动时都会自动检测 pnpm 实际版本与 `package.json` 声明是否一致；不一致时若 corepack 可用会先自动 `corepack prepare` 对齐，失败才需要你手动执行下面的命令。

```powershell
corepack enable
corepack prepare pnpm@12.4.1 --activate
```

---

## 3. 非开发人员（双击脚本用户）怎么办

你不需要敲上面的命令，按顺序做即可：

1. **拉取更新后，先关掉所有正在运行的本项目窗口**（黑色命令行窗口、应用窗口），
   然后**双击一次 `run-local.ps1`**。它会自动补装缺失的依赖。
2. 如果之后启动报 pnpm / 依赖相关的错误：
   删除项目文件夹里的 `node_modules` 文件夹，再重新双击 `run-local.ps1`
   （它检测到依赖缺失后会自动完整重装）。
3. 仍失败：把 `log\` 目录发给团队（见 `docs/guide-non-developer.md` 第 8 节）。

### 为什么脚本会说「依赖与 lockfile 不一致」

`pnpm` 会把**最近一次成功安装时的** lockfile 复制到 `node_modules\.pnpm\lock.yaml`。
它和仓库根 `pnpm-lock.yaml` 不一致，就说明本机装的是旧依赖 —— 拉取更新后没重装，
或上次 `install` 被中断。**`run-local.ps1` 与 `tools/start/verify-quality.ps1` 都会
逐项打印差异**，直接告诉你哪里不一致：

```
[WARN] 检测到依赖与 lockfile 不一致（拉取更新后未重装），将补装依赖...
[INFO] 下面列出不一致的具体位置（仓库 pnpm-lock.yaml 对比最近一次安装时的 lockfile）：
  [直接依赖]
    dependencies（运行时依赖）（.）共 2 项变化:
      + some-new-pkg  ^1.0.0 -> 1.2.3
      ~ next  ^16.3.2：16.3.2 -> 16.4.0
  [解析结果 packages] 新增 1 项 / 删除 0 项
      + some-new-pkg@1.2.3
```

分段含义：**直接依赖**是 `package.json` 里声明、解析版本变了或增删的包；
**解析结果**是 `packages` / `snapshots` 段的条目增删（传递依赖的连带变化）。

只想看差异、不想装依赖时，可手动执行同一条命令：

```powershell
node scripts/lockfile/diff-cli.mjs --installed node_modules\.pnpm\lock.yaml --root .
```

> 若输出里提示「lockfile 里出现重复段落」，说明 lockfile 本身有合并冲突残留或上一次
> `install` 写到一半，按下面第 2 步删掉 `node_modules` 重装即可（必要时同时
> `git checkout -- pnpm-lock.yaml` 回到仓库版本）。

> 原理说明：`run-local.ps1` 只在 `node_modules` 不完整时才重装，因此拉取新代码后
> 它可能「看起来正常但跳过了安装」；一旦新配置与旧 `node_modules` 不兼容，
> 按上面第 2 步删掉重装即可。

---

## 3.1 更安静的一种：锁文件对得上，而新加的包**解析不到**（ISSUE #1721）

上一节那种「不一致」是**会说出来的** —— 有 `[WARN]` 行、有一份逐项差异。还有一种
同源故障**什么都不说**，因为它被上面那道判据的取值口径漏掉了：

> 本地 `node_modules` 停在**装某个新直接依赖之前**的那一刻，于是那个包只以**传递依赖**
> 的**旧版本**存在、并且落在**别的包自己的私有层**里；顶层既没有提升出来的那一份、
> 也没有任何可解析路径。**两份 lockfile 的实质内容可以逐字一致**（本机装的就是
> `package.json` 声明的那一套的一部分），所以「依赖与 lockfile 不一致」这套判据判绿，
> 而报错出现在别处。

### 现场长什么样（实测记录）

`axe-core@4.14.0` 被加进 `package.json` 的 devDependencies 之后，没重装依赖的检出上：

- `pnpm exec tsc --noEmit` / `eslint` 报 `Cannot find module 'axe-core'`（TS2307）——
  这个包**只在测试文件里**被 import，但类型检查与 lint 是全仓扫的，所以照样红；
- `node_modules/axe-core` 这个顶层目录**根本不存在**（连「空目录」都不是）；
- 但它**确实在树里**：`node_modules/@storybook/addon-a11y/node_modules/axe-core`
  是那个**旧版本 4.13.0** —— 它是 `@storybook/addon-a11y` 的依赖，被放在**那个包自己的
  私有层**；顶层与祖先目录都解析不到它。这就是「装了、但是装旧了、而且没提升出来」。

### 为什么「删掉重装」不是这里的处方

上一节的两条出口（`pnpm install` / 删 `node_modules` 重装）**都能修好它**，但前提是
你先知道要修。这一档的麻烦在于**判据不报**：`pnpm install` 之外没有任何东西提醒你，
于是它会以「一个和本次改动无关的报错」的形态反复出现。**实测处方就是普通的那一条**
（`pnpm install`，4.14.0 装上、顶层链接恢复、解析正常），真正的改动是让这条故障有判据。

### 现在谁在守它（`pnpm check:deps-freshness`）

这条判据的第二层（③）现在有两块：

| 层       | 判什么                                                   | 判据在哪                                                |
| -------- | -------------------------------------------------------- | ------------------------------------------------------- |
| 文本层   | 两份 lockfile 的**实质**差异（上一节那种）               | `node_modules/.pnpm/lock.yaml` ⇄ 仓库 `pnpm-lock.yaml`  |
| 解析层   | `typescript` / `next` / `axe-core` 这几个包**解析得到吗** | `scripts/launcher-core/worktree.mjs` 的 `unresolvableDeclaredDeps()` |

解析层红了会**单独**说一句话，别把它读成上一节那种「装错了版本」：

```
这些被声明的依赖在当前 node_modules 里**解析不到**：axe-core
它们可能只以**别的版本**存在（被某个包当传递依赖拖进来、落在包自己的私有层），
而顶层既没有提升出来的那一份、也没有任何可解析路径 —— 表现是 tsc / eslint 报
`Cannot find module`（TS2307），而两份 lockfile 其实是对得上的。
出口：在项目根执行 pnpm install（动手前先 `pnpm deps:guard` —— 本检出的应用服务在跑时它会拦下：原生模块被进程锁住会让安装 EPERM 连锁失败，AGENTS 硬规则 9）。
```

判据的入口与触发时机：`pnpm check:deps-freshness`（**开工前 / 评审前**，AI 与人都该先跑
这一条），`--offline` 只看本地这几层；pre-commit 的 `deps-freshness --staged` 那一档只在
**本次提交动了依赖面**时才判。整条的判据口径见规范
[13.5.13](../standards/13-提交与-code-review.md#13513-依赖新鲜度远端改过库的版本本地还在旧的上面干活-node-scriptscheck-deps-freshnessmjsissue-1569)。

> **为什么解析层只点名三个包，而不是扫全部 `package.json`**：判据的代价要付得起。
> 这三条是跑门禁时**无论如何都会解析到**的包（`tsc` 编译需要 `typescript`、测试 / 构建
> 需要 `next`、a11y 用例需要 `axe-core`）—— 多解析一次不产生新的工作，而「把所有直接依赖
> 都解析一遍」会让判据跟着依赖表一起长。**新加依赖时顺手把这条清单补一格**，位置就在
> `RESOLVE_PROBES`。

> **依赖从来没装过时不报这一条**（`no-install`）：对着一棵不存在的树说「这三个包解析不到」
> 是准确的噪声，动作一样是重装、结论却读起来完全不同（「没装」vs「装错了」）。

---

## 4. 快速对照表

| 你的情况 | 要做的事 |
|---|---|
| 只是普通拉取（没改依赖/配置） | 无需操作，直接启动 |
| 拉取后 `pnpm-workspace.yaml` / `pnpm-lock.yaml` 有变更 | `pnpm deps:guard` 通过后 `pnpm install` |
| `tsc` / `eslint` 报 `Cannot find module '某包'`，而两份 lockfile 看起来一致 | `pnpm deps:guard` 通过后 `pnpm install`（见 §3.1：新加的依赖没提升出来，旧版本被别的包扣在自己私有层里） |
| install 报 `ERR_PNPM_IGNORED_BUILDS` / 年龄门槛错误 | 删除 `node_modules` 后重新 `pnpm install` |
| pnpm 版本与仓库要求（12.4.1）不一致 | `corepack enable` + `corepack prepare pnpm@12.4.1 --activate` |
| 双击脚本用户，拉取后启动报依赖错误 | 删 `node_modules`，重双击 `run-local.ps1` |
| dev server 正在运行 | 不用自己判断、也不用手工关窗口：`pnpm deps:guard` 按归属认出本检出的应用在跑并拦下（判到即停，附 PID）。关掉那个窗口再装即可；判据本体见规范 §3.2 |
| 不想关窗口，只想让界面用上刚拉到的新代码 | 重载一次页面（`Ctrl+R`）即可；「应用一直开着导致界面比代码旧」的成因与处置见 [`../guide-stale-code.md`](../guide-stale-code.md) |
