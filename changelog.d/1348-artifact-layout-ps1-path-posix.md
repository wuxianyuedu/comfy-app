## Fixed

- **`tests/artifact-layout-single-source.test.ts` 在 POSIX 上恒红 —— 这条不是本 PR 引入的**
  （ISSUE #1348 的收口判据，随 #1348 落进 `master`）：

  那条「`comfyapp://` 的 PowerShell 允许根与 TS 的产物根同形」的成对判据，从
  `scripts/comfyapp-open-folder.ps1` 里抠出 `Join-Path $PSScriptRoot "..\public\generated"`
  的相对段后直接用 `path.resolve` 解析。**分隔符是 Windows 形态**，而 `path.resolve`
  只在 Windows 上把 `\` 当分隔符 —— POSIX 上整串被当成一个文件名，
  `path.resolve(scriptsDir, "..\\public\\generated")` 得到
  `<repo>/scripts/..\public\generated`，与 `generatedRoot()` 的
  `<repo>/public/generated` 永不相等，于是**每一次 `pnpm test` 都红**。

  复算证据（§13.6.2 第 1 步）：在干净 `master`（870ebf18）上单跑该文件同样 4 例 1 失败，
  报错逐字相同 —— 与本次改动无关。它挡路的原因是 `affected-tests.mjs` 按静态 import
  图把该文件拉进了受影响集，红一次就拦下所有提交。

  修法：**只在判据内部把分隔符归一成 POSIX** 再解析（`.ps1` 是 Windows 形态，
  归一后两侧都真解析一次）。判据语义一分不减：`..\..\public\generated` 那种偏移一位的
  错法归一后仍会解析到别处、照样被照出来。**没有**登记进 `KNOWN_FAILED_FILES`
  —— 那会把这条判据在 Windows 上也一起静默（粒度是文件，一条红放行全文件）。
