## Fixed

- **GitHub 镜像仓桌包档四跑全红、artifact 与滚动 `nightly` Release 从第一天起为空**
  （#3260；`.github/workflows/package-desktop.yml` 的 `打包·桌包工具预置` 格）：
  schedule #1~#4 均 `failure`、失败步只活 3-4s、退码 `exit code 2`，`pnpm tauri build`
  与后面三格整片 `skipped` ⇒ 一次都没出过 `.msi` / `-setup.exe`。
  根因不是资产失效（zip / dll 的 URL、`sha256`、字节、zip 顶层 `nsis-3.13/` 与
  `NSIS_PLAN.required` 六件逐件实测为真），而是 `scripts/tauri-tools-cache.mjs` 的
  `--download` 用 `tar -xf` 解 zip：本步 `shell: bash` 是 Git Bash，里面的 `tar` 是
  **GNU tar、不读 zip**（本机可复现：`tar: This does not look like a tar archive`，退 2），
  于是下载刚完就 `bail(2)`。`ci-toolchain-browser-fetch.mjs` 早就记过这条平台假设的坑。
  修法：解 zip 改走仓内既有的纯 Node `extractZipTo`（`node:zlib` + central directory，
  带 zip-slip 防护），默认 `runCmd` 只把 `tar` 那一次翻译过去，`download()` 主体与
  用例经 `run` 注入假件的编排形状一字未改（16 条用例仍全绿）；本机按 workflow 原样的
  `ensure || (download && ensure)` 链真下载复跑，`CHAIN_EXIT=0`、442 件镜像建成、
  必需六件齐、bundler 落点补齐。
  workflow 侧同批：工具根从写死 `D:\ci-tools` 换成 `${{ runner.temp }}\ci-tools`
  （`actions/cache` 的 `path` 同源），不押盘符；`upload-artifact` 加
  `if-no-files-found: error`（没成品即红，不 warn 蒙混）；nightly 步把「数 `.exe/.msi`」
  提到 `gh release create` 之前，避免空手时先 create 出一个没有资产的滚动 tag。
  `permissions: contents: write` / `--clobber` / fail-closed 三态退码维持不变。
