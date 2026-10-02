## Added

- 依赖漏洞扫描门禁 `scripts/check-dependency-audit.mjs`（ISSUE #1331，规范 §13.5.9）。
  本仓此前**没有任何**依赖漏洞扫描（无 `pnpm audit` 门禁、无 dependabot/renovate），
  「发现 CVE」这一步全靠人肉；台账按 `(包名, advisory id)` 记账而不是按计数，
  双向拦（基线外新增 → 红；基线里已不再命中 → 也红），每条基线必须有 `reason`，
  `--update` 只许降且**拒绝把新增写进基线**。判据由 `tests/dependency-audit.test.ts` 钉住。
- 它住在 `pnpm check:all` 那一档、**刻意不进 `.githooks/pre-commit`**：这是网络请求，
  离线或 registry 抖动不该变成提交失败（§13.5.4）。拿不到 registry 时判「未扫描」退 0，
  但话术里不许出现「干净」；stdout 不是 JSON 或 pnpm 压根没起来则判红（那是判据坏了）。
  两侧同步三处：`quality-gate.mjs` 的 `GATES`、`quality-gate.ps1` 的 `$Blocks` 与 `-Mode`
  单选值、launch-and-build §9.5 跨平台动作对照表新增一行。

## Fixed

- `scripts/quality-gate.ps1` **整份脚本此前解析失败**（`fbabbc25` 引入）：第 56 行那个正则写在
  双引号串里、用了 `\"` —— PowerShell 的转义符是反引号不是反斜杠，于是字符串被 `\"` 提前结束，
  `[Parser]::ParseFile` 在 PS 5.1 与 pwsh 7 上**各报 3 个错**（本机实测），不论 `-Mode` 给什么都
  进不了脚本体 —— 也就是说 Windows 那一侧的一键门禁一直是死的，而**没有任何自动化执行者会去
  解析 `.ps1` 的语法**，所以这件事红不出来。改成单引号串后两个宿主都是 0 个 ParserError。
  本条是为了给 `check:all` 加新门禁（下面那批）时撞上的；同文件里另一条「依赖一致性预检用
  SHA256、而它的差异明细用 Node 语义比较器，两个结论互相矛盾」的缺陷**不在本刀修**，另开一条追
  （修法与正反验证写在那条里）。
- 清掉扫描出来的**全部 10 条 high/critical**（其中 1 条 critical）：`next` 与
  `eslint-config-next` 16.3.5 → 16.3.8（critical 的修复线是 `>=16.3.6`），
  `js-yaml` / `fast-uri` / `undici` / `brace-expansion` 按 major 加 `overrides` 取
  同 major 的最小修复版（`brace-expansion` 有两条 major 同时中招，键上不带 major 会把
  1.x 的消费方顶到 5.x 的 API 上）。修完重数为 0 条，台账为空。
  `moderate` / `low` 那 15 条本轮不纳入判据，理由写在 §13.5.9 与脚本头。

## Changed

- `scripts/quality-gate.mjs` 里「用 node 直跑门禁脚本」那条分支从只认 `.cjs` 扩到也认
  `.mjs`：只认前者会把新加的 ESM 门禁当成 pnpm 参数送出去。
