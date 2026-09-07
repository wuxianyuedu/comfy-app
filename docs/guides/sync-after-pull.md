# 拉取更新后：本地环境同步指南

> 适用对象：所有在本地跑过本项目的人（开发人员 / 非开发人员通用）。
> 回答一个常见问题：**远端提交改了 pnpm 相关配置，我本地 `git pull` 之后还要做什么？**

---

## 1. 为什么要做这一步

从 2026-09 起，本仓库把 pnpm 11 的项目级配置迁移到了 `pnpm-workspace.yaml`
（详见 `docs/standards/launch-and-build.md` §6「工具链钉死项」），关键配置包括：

| 配置 | 作用 |
|---|---|
| `minimumReleaseAge: 0` | 关闭 pnpm 11 默认的「新包 24h 拒装」供应链门槛 |
| `verifyDepsBeforeRun: false` | 关闭 pnpm 命令前的隐式自动 `pnpm install` |
| `allowBuilds` | 显式批准含 postinstall 构建脚本的依赖（如 better-sqlite3、esbuild、msw） |
| `package.json` → `packageManager: pnpm@11.25.0` | 钉死 pnpm 版本（由 corepack 管理） |

这些配置**只影响新执行的 `pnpm install`**，不会自动作用到已装好的 `node_modules`。
所以本地拉取到这类提交后，需要按下面的步骤让依赖环境与仓库配置对齐。

---

## 2. 标准操作（开发人员 / 熟悉命令行者）

```powershell
# 1) 拉取最新代码
git pull

# 2) 在项目根目录重新安装依赖（会读取最新的 pnpm-workspace.yaml 与 lockfile）
pnpm install

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

本仓库钉死 `pnpm@11.25.0`。若 `pnpm -v` 版本不一致或命令报错，用 Node 自带的
corepack 对齐（corepack 会读取 `package.json` 的 `packageManager` 字段自动切换）：

> **启动器已自动处理**：从 2026-09 起，`tools/start/start-tauri.ps1`、`tools/start/start-web.ps1`、`tools/start/run-local.ps1` 启动时都会自动检测 pnpm 实际版本与 `package.json` 声明是否一致；不一致时若 corepack 可用会先自动 `corepack prepare` 对齐，失败才需要你手动执行下面的命令。

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
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

> 原理说明：`run-local.ps1` 只在 `node_modules` 不完整时才重装，因此拉取新代码后
> 它可能「看起来正常但跳过了安装」；一旦新配置与旧 `node_modules` 不兼容，
> 按上面第 2 步删掉重装即可。

---

## 4. 快速对照表

| 你的情况 | 要做的事 |
|---|---|
| 只是普通拉取（没改依赖/配置） | 无需操作，直接启动 |
| 拉取后 `pnpm-workspace.yaml` / `pnpm-lock.yaml` 有变更 | `pnpm install` |
| install 报 `ERR_PNPM_IGNORED_BUILDS` / 年龄门槛错误 | 删除 `node_modules` 后重新 `pnpm install` |
| pnpm 版本与仓库要求（11.25.0）不一致 | `corepack enable` + `corepack prepare pnpm@11.25.0 --activate` |
| 双击脚本用户，拉取后启动报依赖错误 | 删 `node_modules`，重双击 `run-local.ps1` |
| dev server 正在运行 | 先关掉再装依赖（原生模块会被进程锁住，装到一半会 EPERM 失败） |
