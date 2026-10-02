## Fixed

- **`executable-resolve` 的 POSIX 那几档判定在 Windows 开发机上要么零执行者、要么假绿**（台账 E12；`99323be7` / ISSUE #1327 落地时带着它自己的 5 条红）。模块把 `platform` 做成了参数，于是可以「假装是 linux」，但**「这个候选起不起得来」那一步仍然问真机器** —— 而本机实测：`fs.accessSync(X_OK)` 对 0o755 / 0o644 / 0o444 / 0o000 **一律通过**（Windows 不参与判断执行位），把真 `.exe` 改名成无扩展名再 spawn 得到 `ENOENT`（CreateProcess 不认）。结果：
  - 4 条 POSIX 用例真红（`PATH 上找到就用绝对路径` / `跳过不可用的候选` / `没执行权限与起不来分开报` / `记忆化按 env 分键`）；
  - 更糟的是旁边那条绿的 —— 「候选存在但不可执行 → 返回 null」看着过了，实际走的是 `ENOENT`（形态起不来）这条**完全不同的**路径，绿灯是假的。
    修法补的是缺的那个注入点（口径同 `kill-process-tree.ts` 的 `COMFYAPP_TASKKILL`）：`UsabilityProbe { access, spawn }` 进 `WhichCommandOptions`，默认值就是原来那两句真调用，生产侧两个消费方（`src/lib/console/console-run.ts`、`scripts/launcher-core/shell.mjs`）零改动。Windows 那几档**不注入**：批处理不起、`.ps1` 落宿主、MZ 头当二进制，这些在本机是真造得出来的，照旧问真机器。
- **解析出来的可执行路径带的是 `PATHEXT` 的大小写，不是磁盘上的那份**：候选名是拿 `PATHEXT` 拼的，而系统默认写成大写（`.COM;.EXE;.BAT;.CMD`），于是 `node` 解析成 `D:\Program Files\nodejs\node.EXE`。spawn 对大小写无所谓，但这一份路径会回显在控制台的 `start` 帧里、也会写进日志，而用户拿它去比对与「点开所在目录」时对不上。现在命中之后向目录本身要一次真实大小写（只在 Windows 做，POSIX 的大小写是要紧的，原样返回；列不出目录时退回拼出来的那份 —— 一个能跑的路径比一次大小写归一重要）。

## Tests

- `src/lib/process/executable-resolve.test.ts`：新增 `posixHost(名单)` / `unusableKind()` 两个探针夹具，POSIX 那四档改成注入判定；把原来那条假绿的用例拆成**两句不同的话**各自钉住（`no-exec-permission` 与 `ENOEXEC` —— 前者是 chmod / 软链 / 挂载选项这一类本机配置问题，后者是「Node 起不了这个形态」，混成一句会把人带去修错的地方）；「跳过不可用的候选」改成两个 PATH 目录并排（前一个里的同名文件没有执行位），这才判得到「扫到 ≠ 能跑」这条判据本身。
- 变异检过两刀：让注入的探针失效（恒问真机器）→ 那 4 条红；去掉大小写归一 → `console-run` 那条红。
