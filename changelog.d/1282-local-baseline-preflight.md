## Fixed

- **「默认不落盘」对缺基线恰好不成立 —— 现在显式争取**（ISSUE #1282）：`pnpm check:visual`
  的文档与注释都写着「默认只在当次检出自证、不落盘，`--update` 才写 PNG」，而 Playwright 的
  `updateSnapshots` **默认就是 `'missing'`**（`playwright test --help` 自陈「Running tests
  without the flag defaults to "missing"」）—— 缺的那几张**不带任何开关也会被创建**，
  写进 `*-snapshots/`。实测：移走 linux 两张基线后跑 `pnpm check:visual`，目录里立刻多回
  两个 PNG（内容与已入库的逐字节相同，所以在录过基线的那台机器上 `git status` 照样干净，
  换成没登记过的平台就是半套未入库基线 —— §11.8 判过那比没有更费人）。修法是检查档显式
  传 `--update-snapshots=none`（新 `CHECK_UPDATE_MODE`），录基线档（`--update`）才放开。
- **「本机没有基线」不再要人先付一遍代价才知道**（ISSUE #1282）：基线文件名带平台 ⇒ 这是
  一个必然会出现、且零代价就能提前命名的状态。`scripts/pixel-run.mjs` 现在**在起 webServer /
  浏览器之前**先答「本机这一档有没有成套基线」（`checkLocalBaselines`）：没有就退出码 2、
  不启动任何进程，并按两条分支给出文件清单与动作 —— 「平台没登记（先录再同批登记
  `SUPPORTED_PLATFORMS`）」与「登记了但缺几张（补录）」。此前的形态是先付一遍构建 + 起服务
  + 起浏览器，再从 Playwright 的输出里读出那句话，还得自己认出它说的是这件事。

## Added

- **基线清点内核 `scripts/visual-baselines.mjs`**（§12.18 / §12.12）：`SUPPORTED_PLATFORMS`、
  spec 扫描、截图名解析、基线名↔平台解析、`missingBaselinesForPlatform`、`untrackedBaselines`
  收成一处，`tests/visual-baseline-pairing.test.ts` 与 `pixel-run.mjs` 的前置判决共同 import。
  两处各抄一份清点代码的话，「判据说基线成套」与「像素档说本机没基线」必然对不上账 ——
  而它们答的正是同一件事的两面。
- **判据两头**：`tests/visual-baselines.test.ts`（一次性夹具把「齐备 / 缺一张 / 整档没登记」
  三种形态各执行一遍，并各判一条前置判决的分支）与 `tests/pixel-run.test.ts` 新增三条
  （检查档必须显式关落盘、录基线档不许被顺手带上、前置判决在真检出上放行并拦得住没登记的档）。
  三个变异（`CHECK_UPDATE_MODE` 改回 `missing`、前置判决永远返回 null、掏空 `SUPPORTED_PLATFORMS`）
  各自恰好红对应用例。

## Changed

- **配对判据的口径说清楚了它**不**管什么**：那三头（齐全 / 入库 / 无孤儿）判的是「仓库里
  那几套基线的形态」，**不回答**「运行这台机器会不会一跑就红」—— 在没登记过像素平台的机器上
  它照样全绿（那是如实回答，不是漏判）。旧注释把两件事混在一起，会让人以为「判据绿了 ⇒
  本机能跑」。规范 §11.8 与 `docs/guides/TESTING.md` 同步。
