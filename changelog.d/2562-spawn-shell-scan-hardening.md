## Changed

**`spawn-shell-scan` 这个闸做了阳性对照 + 扩规则 + 扩面 —— "0 命中"从「看起来干净」升级成「已验证」**（ISSUE #2562）。

之前那句「`shell: true` 字面量实测存活 0 处——闸在工作」是把**两件事**混为一谈了：
0 命中只证明「此刻没有违规」，不能证明「闸能拦下违规」。**一个从没响过的烟雾探测器，
你不能说它工作正常。** 这一轮把缺口补上：

- **缺口 1（阳性对照 / canary）**：新增一条直接跑 `node scripts/spawn-shell-scan.mjs`
  （`pnpm run scan:spawn-shell`）的测试 —— 在临时树里放一个已知 `shell: true` 违例，
  断言脚本**退出码非 0**且把违例点名出来。绿了（没报错）才算闸在工作；那段若也能过，
  那 0 命中只是「从没触发过」。同时确认它**进了 CI 且是 blocking step**：用例在
  `scripts/fixed-structural-tests.mjs` 固定清单里，每个 PR 都跑（不是本地脚本、也不是
  只活在注释里）。覆盖面的三件事逐项验过：退出码非 0 ✓、进了固定清单 blocking ✓、
  扫 `scripts/` `tools/` `.storybook/` `e2e/` 而不只是 `src/`（`src/**` 仍不扫，那侧归
  硬规则 3 的 `kill-process-tree` 族，另有判据，把两边扫描面并到一起只会互相污染）。
- **缺口 2（字面量 `shell: true` 有盲区）**：旧规则把所有字符串值都当「不是布尔开关」放过，
  于是 `shell: 'cmd.exe'` / `shell: process.env.ComSpec` 这类 **truthy 字符串**漏了
  （Node 拿到字符串是「拿它当 shell 可执行文件」，**仍然开 shell**）。现在只排
  `false` / `null` / `undefined` 三种「明确不开」，其余一律算违例。另外补了
  `exec` / `execSync` 检测：它们**天然走 shell**、调用点里一个 `shell` 字样都不会出现，
  旧规则永远看不见；新规则只认从 `node:child_process` import 出来的那个
  （局部函数 / 注入端口同名不算，否则又会误报教会人加白名单）。`execFile` / `execFileSync`
  默认不走 shell，不在这里一棍打死。
- **缺口 3（更该扫的是反向信号）**：`shell: true` 几乎总是为了修 EINVAL 才被加进去的，
  所以真正的前瞻指标是 `spawn` / `spawnSync` / `fork` 的**命令参数是以 `.cmd` / `.bat`
  结尾的引号字面量**。0 个 `shell: true` 但 N 个 `.cmd` spawn 点 = N 个将来会被「加上
  shell 修好」的位置。这一条直接源头收掉（改走 `resolvePackageBinEntry` 直起包真身）。
  要求整段就是一个引号字面量（不脱敏、但排除运行时 `path.join(dir, "pnpm" + ".cmd")` 拼接），
  与整份脚本「不 AST」的取向一致。

判据：`tests/spawn-shell-scan.test.ts` 现 15 条，含三类阳性对照（CLI 真的非零退出 /
  `shell: 'cmd.exe'` 与 `process.env.ComSpec` 算违例 / `exec` 只认 child_process 绑定 /
  `.cmd` 反向信号 / `tools/` 下的违例也抓得到）；真实仓库跑 `pnpm run scan:spawn-shell`
  仍为 0 命中（扩规则 + 扩面后没有现成误伤）。
