## Fixed

- **三处只在「读代码」时看不见、跑起来才成立的本机进程缺陷**（台账 E7 的 process 那两项还清时照出来的）：
  - **Windows 保活中介超时那一路读不回任何原因**：`waitForDetachMediator` 的超时兜底在**调用那一刻**就算好了，于是超时永远回 `stderr: ""`。而「中介没退出」恰恰只在超时时发生 —— `Start-Process` 参数被拒这类拉起失败的原因就只有这一路拿得到，此前被丢掉了。改法按 `~/lib/with-timeout` 自己的口径（兜底是**值**不是工厂，要按当时状态算就自己包一层）：超时之后再读已收集的 stderr。
  - **POSIX 保活开日志文件开到一半失败时漏句柄**：`spawnManaged` 的 keepAlive 分支先 `openSync(stdout)` 再 `openSync(stderr)`，第二个抛错就没人管第一个 —— 父进程长期持有那份日志文件（Windows 上的表现是轮转与删除全部失败），而调用方只拿到一句 error。现在两条失败路径（开文件失败、spawn 自己抛错）都关掉已经开出来的那些 fd。
  - **「不许把应用自己杀掉」那条保守侧没被实现**：`readOwnPgid()` 的注释写着「自身进程组读不到时视同为自身组，即禁用组路径」，代码里两处判据却都是 `ownPgid !== null && pgid === ownPgid` —— 读不到 `ownPgid` 时组信号照发。这条判据的对面是硬规则 3 里最重的一种事故（`kill(-pgid)` 打到调用者所在的整组）。同时把异步版与同步版各抄一遍的那张决策表收成一份纯判据（`planPosixKill` + `executePosixPlan`）：两处副本正是「一处修好、另一处仍是旧的」的来源。
  - 附带：`killProcessTreeSync` 收到 `mode: "image"` 时原本会凑出 `/IM <pid>`（这张签名里没有映像名，是静默杀不到也可能杀错），现在明确拒绝并把该走的入口写在 `via` 里。

## Tests

- **`src/lib/process/**` 的低覆盖不是缺用例，而是「用例只在另一台机器上跑」**：POSIX 判据组整组 `runIf(!isWindowsPlatform())`，在这台 Windows 机器上一条都不执行（`kill-process-tree.ts` 29.1% 行），而 `process-launch.ts` 的 `spawnManaged` 四条拉起路径从来没被任何用例调过（17.9% 行）。
- 新增 `src/lib/process/kill-process-tree.posix.test.ts`：把 `ps` 报什么组号、`process.kill` 接不接受这个目标、该发哪个信号这三件事全部注入，于是**同一张表在两端机器上判同一个结论**（真起进程数残留那组留在原文件里，两边不重复 —— 那边证明「信号真的能带走整棵树」，这边证明「该发哪个、什么时候必须不发组」）。含 `killProcessTreeSync` 与异步版同判据那一组。
- `process-launch.test.ts` 从 3 个纯函数扩到覆盖四条拉起路径与中介句柄：bound 的 stdio 与 `windowsHide` 缺省；POSIX keepAlive 的 `detached` + `unref` 成对、重定向 fd 的「成对才开 / 用完即关 / 半途失败也关」；Windows 拿到 `COMFYAPP_SHELL_EXE` 时走壳的 CLI 形态（参数逐段）、拿不到时退回 `Start-Process`（整段脚本必须是 `-Command` 的**一个** argv）且**必须留下一条警告**；`waitForDetachMediator` 的退出码 / `-1` / UTF-16LE 带 BOM 解码 / 超时给哨兵且不丢已收到的 stderr。
- `kill-process-tree.windows.test.ts` 补两个平台绑定的落点：`killProcessTreeByImage` 在 Windows 上发的是 `/IM <name> /T /F`，`spawnTaskkill` 的命令以 0 退出时回调收到 true（派发成功与失败在日志里不许混成一句话）。
- 本批两份文件的实测：`process-launch.ts` **100/100/100/100**（原 19.35/24.07/45.45/17.85）、`kill-process-tree.ts` **100/96.05/100/100**（原 31.39/25/47.61/29.11）。门槛按**整目录**登记（这个 glob 里还有 #1327 下沉进来的 `executable-resolve.ts`，它的欠账由台账 E12 那一批管）：目录级实测 93.65/87.08/96.49/94.87（语句/分支/函数/行）→ 从 25/20/45/20 抬到 **93/87/96/94**。旧值是棘轮开门那一次为记账而降的，不是目标；余下那点分支不是漏网，是平台绑定或走不到的兜底，逐条写在配置注释里。
- 变异检过：去掉「与调用者同组 → 禁走组路径」→ 5 条红（异步 3 + 同步 2）；把「自身组读不到时视同为自身组」改回旧写法 → 2 条红（两侧各一条，证明不是重复）；`pkill` 的 exit=1 判成失败 → 1 条红；失败路径不关 fd → 2 条红；兜底提前算 → 1 条红。
