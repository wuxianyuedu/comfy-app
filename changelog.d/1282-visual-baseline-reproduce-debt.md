## Fixed

- **入库的 `-linux.png` 像素基线有 4 张与当前环境差 1 像素（文字整体下移一行），已在本机重录成套**（ISSUE #1282）。
  `canvas-filled` / `canvas-empty` / `overlay-log-default` / `overlay-log-wide` 四张的差异带都落在工具栏与分段控件的**文字**上：逐行剖面实测新图 `[y]` 与新环境 `[y-1]` 逐行相等（灰度零差），即整块文字相对既有基线**下移了一行**；其余像素逐点相同（`overlay-log-default` 在标签框内的 MAD 从 23.3 降到 0.000）。
  修法是**按该档登记的口径重录**（`linux` = `start`，`CI` 为真 ⇒ `pnpm start`，先 `pnpm build`），录后全量像素档 `pnpm check:visual` **连跑三次全绿**（改前同一命令 4 failed / 6 passed，其中 `overlay` 两条连同 `login` 之类全绿 —— 缺口只在「文字正好落在那一行」的那几张上）。
  这条红此前**没有任何判据能发现**：`playwright test --update-snapshots` 总是绿（它把基线改写成当次实况）、配对判据只核「截图名 × 平台成套且入库」、`pixel-run.mjs` 的 `--update` 档按设计不拦缺基线 —— 于是一条「在这台机器上录一版、把仓库基线换成它」的路一个判据都没有，而换掉的是**别人那一档**的账。

## Added

- **「换了像素基线 ⇒ 领一张自证欠账」进提交门槛**（ISSUE #1282，`scripts/visual-reproduce-gate.mjs`，pre-commit D 组）。
  - 暂存改动命中任何一张基线 PNG（`changedBaselines`，按 `parseBaseline` 认真正的基线形态，不是「路径里出现过 `snapshots`」）⇒ 本次提交必须同时带来 `scripts/.visual-reproduce-ledger.json`，且记录里的清单**逐字等于**本次动过的那些（多列 / 少列都红，「先领一张空白欠条」这条绕法当场被拦）、`platform` 只能是登记过的档、`reason` 要写清界面为什么变。
  - **两个方向都拦**：动了基线却没有欠账 / 欠账与它列的对不上 ⇒ 红；**没动基线却留着欠账** ⇒ 也红（上一批自证完忘了抹账 —— 欠账单会退化成一张没人删的赦免名单，与 `PENDING_PLATFORMS` 的双向不变式同族）。判决整个委托给 `checkReproduceDebt`，`runGate` 不另立一条 `changed.length === 0` 的短路（那会把抹账那一格静默放过）。
  - 记账与自证分开：`--record <平台> <原因>` 记欠账（给人用，不进钩子），自证走 `pnpm check:visual:update` → `pnpm check:visual`（**连跑两次都绿**），完成后把欠账删掉（负债补齐即抹账）。
  - 钩子里**不跑像素**：`pixel-run.mjs` 要起 webServer + 浏览器，与钩子里的 A/B/C/D 抢资源（§13.5 的并行预算是实测敏感项）。钩子只做它能做的那件事 —— **不许静默换基线**。
  - 清点内核（`changedBaselines` / `reproduceDebtRecord` / `checkReproduceDebt`）与配对判据、前置判决同处一份（§12.12）；判决抽成纯入口 `runGate`，`tests/visual-reproduce-gate.test.ts` 喂三种形状执行它（没动基线 / 动了没领账 / 领了但对不上）。

## Tests

- `tests/visual-reproduce-gate.test.ts`（10 条）：识别面只认 `*-snapshots/<名>-chromium-<平台>.png`（spec / `support/**` / 形如 `-window` 的手滑名都不算）、没动基线零打扰、动了没领账阻断且话说清「`--update` 为什么证明不了」、领了且对得上放行、少列 / 多列各判一条、`platform` 与 `reason` 各判一条、领账与校验是**同一份形状**（各写一套时领出来的账会被自己的校验判成对不上）、以及钩子真的调它。
- 变异核过：把欠账文件删掉 ⇒ 钩子那一步红（`--staged` 直喂）；把 `e2e/visual/**` 之外的文件喂进识别面 ⇒ 零输出。

## Docs

- 规范 11 §11.8：新增一条 ⚠️ ——「换了基线」这条路上此前三个判据都看不见它，以及欠账单的两个半边（领取 / 记账）与「钩子里不跑像素」的理由。
- 规范 13 §13.1 自查清单登记这一步；§13.5.4 补一句「钩子里唯一与像素层有关的一步就是它」。
- `docs/guides/TESTING.md`：补欠账的记法与自证动作。
