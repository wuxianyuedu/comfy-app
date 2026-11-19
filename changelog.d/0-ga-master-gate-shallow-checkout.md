## Changed

**GA master-gate.yml 检出面从全历史 + LFS 缩到浅克隆**（GA 侧适配清单 P0-1）

master-gate.yml 的两条文档链命令（`render-doc-placeholders` / `check-doc-references`）
只读当前树文件内容，不做三点 diff 也不碰字体等 LFS 对象。此前检出配置 `fetch-depth: 0`
+ `lfs: true` 对这两格是纯开销，冷装多花几秒拉全历史。

- `fetch-depth: 0` → `fetch-depth: 1`
- 删掉 `lfs: true`（默认 false）
- pnpm install 保留（不为省时间引入「无 node_modules 能否真跑」的未验证前提）

CNB 侧完全不动（任务 3 并行期纪律，§13.5.34）。
