## Fixed

- `saveModeContractsAsProjectDefaults` 并发覆盖与半截 JSON（#3911）：并入同文件
  既有的 `overrideFileMutex` 串行化、落盘改 `atomicWriteText`（tmp+rename）——
  与 `saveModeContracts` / `resetModeContractOverride` 同一纪律，不再有「按旧
  基线合并后整包覆盖、崩溃留半截 JSON」的旁路。
