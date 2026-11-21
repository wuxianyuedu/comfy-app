## Fixed

- `scripts/` 剩余 64 处不带预算的短 `spawnSync`（多为 git 一次性读数）迁到带预算执行器 `runGateStep`：git 一次性读数给 30s 档（与 premerge-proof 同口径），oxlint/tsc 探针 120s，vitest/自证/工具链步骤 600s，next 构建 900s，账本 fetch/push 300s——git 锁竞争、杀软扫描、网络悬挂时不再无限卡住提交/推送。三处长驻服务本体（`dev.mjs` / `start.mjs` / `storybook.mjs` 起的 server）刻意保留不限时并写明理由；三个 toolchain 探针文件与两个会被沙箱用例单独拷贝真跑的脚本（`install-git-hooks.mjs` / `storybook-check.mjs`）按既有约束保留裸 `spawnSync` + 显式预算。`runGateStep` 补 `input` 透传（stdin 注入）并放宽 `stdio` 类型。（#4679）
