## Fixed

- **端口推导在 Linux 上算错，CI 的全量测试因此必挂两条**：`scripts/app-port.mjs` 的路径规范化把 Windows 盘符路径（`F:\AI\Other\comfy-app-t3-branch`）交给平台相关的 `path.resolve`，在 POSIX 上会被当成相对路径拼到 cwd 前面（`/workspace/f:/ai/other/...`），同一份检出算出两个端口——多检出并行的前提（同一检出恒定同端口）当场失效，跨语言对齐的固定校验向量也对不上（`tests/app-port.test.ts` 的两条断言在 Linux 上失败）。现在盘符路径只做分隔符统一与大小写归一，不再走 `path.resolve`，Node / PowerShell / Python / Rust 四侧对同一路径重新给出同一端口（锚点 `f:/ai/other/comfy-app-t3-branch` → 3305 保持不变）。

## Changed

- **质量门禁的「已知基线失败」清单清空**：`scripts/quality-gate.ps1` 里登记的 `task.test.ts` / `generate.test.ts` 已随 enqueue 拆分（mock 边界从 `runner` 改到 `enqueue`）恢复通过，按规范 11.12 第 3 条删除登记项，让它们回到门禁里被强制拦截——继续留在清单里会永久静默跳过，退化不会再被发现。清单机制保留，下次出现"确证与本改动无关"的历史失败时再登记。

## 合并说明

- 与 `feat(platform): Web-only Linux 模式`（PR #495）合并时，两侧都独立修了同一处
  「盘符路径被 `path.resolve` 拼上 cwd」的缺陷，冲突取**语义超集**：
  保留 PR 侧的「绝对路径原样 + 去尾斜杠 + UNC 判据」（与 PowerShell `GetFullPath`、
  Python `abspath`、Rust 只做 replace+lowercase 三侧行为一致），同时把盘符判据的
  源码写法收敛为主干测试锁定的 `/^[a-z]:\//i` 与 `isWindowsDrive` 变量名。
  锚点 `f:/ai/other/comfy-app-t3-branch` → 3305 未变。
