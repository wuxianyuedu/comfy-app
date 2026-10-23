## Changed

- **`run-local` 现在也会跑 `pnpm env:init`，补齐 `.env` 里缺失的可选键** —— 之前 Windows 侧
  `tools/start/run-local.ps1` 走 `scripts/prepare-local-run.ps1` 第 4 步只「从 `.env.example` 生成
  `.env`（已存在则跳过）」，于是本仓后续新增的可选键（如 `COMFYAPP_DEV_HANDLE` —— #2175 的启动留痕
  全靠它）不会自动进老 `.env`，得手动补。现在第 4 步之后追加 `pnpm env:init`：
  `scripts/env-init.mjs` 只补**没有**的键、绝不覆盖已有的；失败也只是警告、不阻断启动（是
  「能补就补」的增强，不是硬依赖）。`docs/guide-non-developer.md` §4.2 的 run-local 步骤同步
  补了一行说明。
  （ISSUE #2158 收尾的同批改动；该 issue 的 #1 / #2 已各自单独立 issue）
