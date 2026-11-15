## Fixed

- `tools/start/take-screenshot.ps1` 文件头归一为单个 BOM（#3946）：#3810 落盘时带的是
  **两个**前导 BOM，第二个成了正文杂散字符，PowerShell（5.1 与 7 同）解析报 2 个
  ParserError——`tests/quality-gate-ps-precheck.test.ts` 那格在本地全量红、
  Linux CI 上因 `skipIf(!hasPs)` 跳过而看不见。本轮 #3930 的 premerge 复算撞上后
  当场归一，解析复验 0 errors。
