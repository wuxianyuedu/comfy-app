## Added

- **像素回归有了「谁跑、怎么跑、红算什么」的入口（`pnpm check:visual`，ISSUE #1282 收口）**。此前 `pnpm test:visual` 这个脚本存在，但不回答三个问题：它跑出来的绿证明不了基线还在仓库里（配对判据是另一次运行）、红指向什么动作（缺本平台基线 / 逐帧 chrome / 像素 diff 三件事的处置完全不同）、以及「顺手落盘」该不该发生。现在这三件都由 `scripts/pixel-run.mjs` 一次性给出来：
  - **同批跑两次**：像素档（`e2e/visual`）+ `tests/visual-baseline-pairing.test.ts`。少一次 = 交出一批基线而「基线成套且入库」不在这一轮里判 —— 那正是 #6538809 的形态。
  - **默认不落盘**：基线是人工 review 的核心对象。落盘走显式 `--update`（`pnpm check:visual:update`），且验收口径是**这台机器连跑两次都绿**，不是「那一次写成功了」。
  - **红的定性**按三条实测形态分档：`A snapshot doesn't exist at …-<platform>.png` = 这台机器没有基线（按 §11.8 登记平台 + 成套录，别当回归去改业务代码）；`Failed to take two consecutive stable screenshots` = 页面里有逐帧 chrome（加 mask，放宽阈值只会让基线失去意义）；diff 数字 = 这才是退化。认不出的一律先按 §11.13 隔离重跑定性。
- 跨平台入口：`scripts/quality-gate.mjs` 新增 `GATES.visual`（**`run: false`，不在 `check:all` 里**），Windows 侧同一动作是 `scripts/quality-gate.ps1 -Mode visual`；对照表已登记在 launch-and-build §9.5。不在 `all` 里的理由是两条实测：起 webServer + 浏览器的代价，以及**结论只在录过基线的那台机器上成立**（基线文件名带平台）。

## Fixed

- `scripts/pixel-run.mjs` 的子进程环境不再把 `CI=""` 传下去 —— 空串**不等于「未设置」**，而 `playwright.config.ts` 判的是真假。原写法会让本机（实测：容器与流水线里 `CI=true` 是常态）在无产物时被引到 `pnpm start`，现场是一句 `Could not find a production build in the '.next' directory`，与像素毫无关系却读起来像「要先构建」。

## Tests

- `tests/pixel-run.test.ts`（9 条）：两次运行必须同批（`--update` 也不例外）、默认不带 `--update-snapshots`、像素目录与 `package.json` 的 `test:visual` 同源、以及**四条红的定性各判一条**（缺平台基线 / 逐帧 chrome / 像素 diff / webServer 起不来）—— 定性混成一句「像素档红了」就会把人引去改业务代码。
- `tests/ps1-consistency.test.ts` 新增一条：两侧门禁名集合必须一致，并另钉**按需档在场地**（`Run=$false` / `run: false` 两侧同名且非空）。变异核过三种形态：从 `.ps1` 摘掉 / 两侧一起摘掉 / 把 `Run` 改成 `$true` —— 三条都红，复位全绿。
