## Fixed

- **入库的 `-linux.png` 像素基线有 4 张与当前环境差 1 像素（文字整体下移一行），已在本机重录成套**（ISSUE #1282）。
  `canvas-filled` / `canvas-empty` / `overlay-log-default` / `overlay-log-wide` 四张的差异带都落在工具栏与分段控件的**文字**上：逐行剖面实测新图 `[y]` 与新环境 `[y-1]` 逐行相等（灰度零差），即整块文字相对既有基线**下移了一行**；其余像素逐点相同（`overlay-log-default` 在标签框内的 MAD 从 23.3 降到 0.000）。
  修法是**按该档登记的口径重录**（`linux` = `start`，`CI` 为真 ⇒ `pnpm start`，先 `pnpm build`），录后全量像素档 `pnpm check:visual` **连跑三次全绿**（改前同一命令 4 failed / 6 passed，其中 `overlay` 两条连同 `login` 之类全绿 —— 缺口只在「文字正好落在那一行」的那几张上）。
  这条红此前**没有任何判据能发现**：`playwright test --update-snapshots` 总是绿（它把基线改写成当次实况）、配对判据只核「截图名 × 平台成套且入库」、`pixel-run.mjs` 的 `--update` 档按设计不拦缺基线 —— 于是一条「在这台机器上录一版、把仓库基线换成它」的路一个判据都没有，而换掉的是**别人那一档**的账。

## Added

- **「像素基线每档都有主」进提交门槛**（ISSUE #1282，`scripts/visual-freshness-gate.mjs`，pre-commit D 组）。
  「录过一次」与「一直绿」是两件事：linux 档此前的状态是「录过就算数」—— 入库的 `-linux.png`
  有 4 张与当次环境差 1 像素，而没有任何东西记着这一档上次被跑绿是什么时候、下一次该由谁跑。
  前一档（win32 缺几张）的账有 `PENDING_PLATFORMS`，这一档一条都没有。
  - 每一**登记档**必须有一条**新鲜度记录**（`scripts/.visual-baseline-freshness.json`），写清
    **谁 / 什么时候 / 按哪条命令复核的**；记录不许挂在非登记档上（删了平台的档要同批抹账）。
  - 记录由 `pnpm check:visual` **跑绿即记**（`scripts/pixel-run.mjs` 的 `recordFreshness`）：
    `--update` 不记（写成功不是自证）、红着不记（跑过 ≠ 跑绿过）。每次提交顺带打印各档
    「上次自证距今多久」。
  - `PENDING_PLATFORMS` 那一档不要求新鲜度记录（缺几张基线，记「上次跑绿」是句不成立的话）——
    两张表各管一件事：pending 管**数量**、新鲜度管**时效**。
  - ⚠️ **刻意不做墙钟阻断**：像素结论只在录过基线的那台机器上成立，win32 档只能在那台 Windows
    机器上复核，拿时钟阻断等于让所有人卡在一个只有少数人能解的账上（与 pending「只提醒、
    不阻断」同味）。纪律收在**可观测的形状**上，阈值由人看着读数定。

## Removed

- **「换了像素基线 ⇒ 领一张自证欠账」那张表整个撤掉**（含 `--record`）。它的方向是反的：
  把成本压在「换基线的人」身上，而这条红的真正受害者是「信任这批基线的人」；且它记的是
  「我换过」这个**动作**，不是「它现在还绿」这个**状态** —— 于是一张空白欠条能合法地停留在
  仓库里，直到下一个人去那台机器上跑。撤掉的清单：`scripts/visual-reproduce-gate.mjs`、
  `scripts/.visual-reproduce-ledger.json`、`tests/visual-reproduce-gate.test.ts`、
  `scripts/visual-baselines.mjs` 里那三个出口（`REPRODUCE_LEDGER` / `changedBaselines` /
  `reproduceDebtRecord` / `checkReproduceDebt`），以及 pre-commit D 组的那一步。
  同批撤掉的还有 `changelog.d/1535-visual-reproduce-gate-merge.md` 记的那个补丁（合并态下
  补「被合进来那侧带进来的基线」，`withMergeHeadBaselines`）—— 整条判据都没了，它要补的
  那一格也随之不存在。

## Tests

- `tests/visual-freshness-gate.test.ts`（11 条）：五种形状各喂一遍（每档齐全 / 一档没记 /
  `who` 与 `how` 空着 / `verifiedAt` 解不开 / 记录挂在非登记档上）、pending 档不被要求且以
  「待补录」出现在读数里、`freshnessAge` 对解不开的日期与未来时间都返回 null（不许把「没记」
  读成「刚刚跑过」）、仓库当前那份账能过自己的判决、以及钩子真的调它。
- 变异核过三条：`required` 退化成恒空 ⇒ 红 5 条；删掉账文件 ⇒ 红 2 条；摘掉钩子里那一行 ⇒ 红 1 条。

## Docs

- 规范 11 §11.8：把「欠账单」整段换成「新鲜度账」，并**把两条路的形状都记下来**（欠账那条
  为什么是反的、现在这条为什么记状态而不是动作）。
- 规范 13 §13.1 自查清单与 §13.5.4 同步换成新的一步；`docs/guides/TESTING.md` 补记账动作。
