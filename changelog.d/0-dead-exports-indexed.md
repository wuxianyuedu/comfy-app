## Changed

- **`check-dead-exports` 改为预建索引，判据不变、单次约 57s → 1.6s（提交门禁提速）**：
  `scripts/check-dead-exports.cjs` 原实现每判一个值导出，就把「src+scripts+e2e 拼接的全仓语料」
  按 `\b名\b` 正则 `split` 一遍计数，且**每个模块**都重新 `walk` + `readFileSync` 一遍 `tests/`
  找它的同域单测 —— 一次扫描实测 57s（并行门禁里争 CPU 时到 114s）。改为**先建索引再查表**：
  生产语料按词元切**一遍**建成词频表（`mentions(名)` 退化成 O(1) 查表；对 `\w` 标识符与旧
  `\b名\b` 计数逐字等价，含 `$` 的名字旧正则因未转义 `$` 锚点基本不命中、词元表同样把它切断
  → 行为一致）；所有测试文件**预加载一次**（词元 Set + 归一 import 说明符），模块↔单测匹配只在
  内存比对。保留旧语义的两处细节：同基名测试「存在即算消费方」、以及 `importsModule` 的
  `endsWith` 模糊匹配（收进 `matchedTestFilesOf` / `specsImport`）。等价性由
  `tests/check-dead-exports.test.ts` 的 18 例夹具（含非空死集、type/interface 排除、别名导出、
  三种测试布局、ratchet/--strict/--verify）+ 两条真实仓库用例全绿证明。
