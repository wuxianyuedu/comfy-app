## Changed

- CI（GA 侧换镜像试跑）：8 个 workflow 的 Ubuntu runner 从钉版 `ubuntu-24.04` 换到 `ubuntu-26.04`（`package-desktop.yml` 的 `windows-2022` 桌包平台不动）。`ubuntu-latest` 的 24.04→26.04 迁移窗口 2026-10-19 ~ 11-19 即将结束，显式钉 26.04 而非跟浮动标签，让镜像版本由仓库决定、不随平台排期漂移；26.04 镜像已 GA，本轮靠 GA 全量跑一遍验证兼容（尤其是显式 apt 装的 Tauri 系统库那条）。同步把 pr-gate.yml 里针对 24.04 预装清单的注释改成「不依赖镜像预装、显式 apt 装」的中性表述，避免对未核实的 26.04 预装内容做断言。
- 测试（`tests/ci-ga-trigger-map.test.ts`）：新增判据——动态枚举 `.github/workflows/*.yml`，断言每个 `runs-on` 都是显式钉版（`ubuntu-N.N` / `windows-NNNN`）、不出现 `*-latest`，把「换镜像是单独一次决定」钉成机器规则；新增 workflow 自动纳入扫描面。
