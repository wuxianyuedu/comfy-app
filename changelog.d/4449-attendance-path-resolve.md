## Fixed

- `check-daily-attendance` 的直跑判据双侧 `path.resolve` 归一。此前
  `import.meta.filename === process.argv[1]` 在 argv[1] 保持相对形态（旧版 Node /
  特定 loader）或路径大小写不一致时永不命中——出勤判据「在册、恒绿、永不执行」。
  与 `ci-build-readout.mjs` 的同款判据对齐。（#4449）
