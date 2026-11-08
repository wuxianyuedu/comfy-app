## Added

- **GA 桌包档：安装版与免安装版分开下载（ISSUE #3345）**。此前 `package-desktop.yml`
  把 `bundle/` 整个传进一个 artifact，滚动 `nightly` Release 里也只有 `setup.exe` /
  `.msi`，要免安装版的人得自己翻。新增 `scripts/package-desktop-portable.mjs`
  （`pnpm package:portable`，Windows 双击入口 `tools/build/package-portable.ps1`）：
  只读 `pnpm tauri build` 产出的三件现成产物（壳 / sidecar / `static`），按规范 §7.6
  实测的**打包器同布局**收成 `ComfyAPP-portable.zip`（`app.exe` + `node.exe` +
  `static/**`），解压双击即用、无需安装与本机 Node。**不是第二种构建**，换的是分发
  形态、不出第二份载荷。GA 侧拆成两个 artifact（`comfyapp-desktop-installer` /
  `comfyapp-desktop-portable`），Release 资产名字带 `portable` 一眼可分；两类成品
  都数过才动 Release，缺任一类退 1。组装脚本按「发现 `binaries/` 里本轮 sidecar」
  取件，不重抄目标三元组映射表；三态退出码（缺件 / 没结论 / 写盘被拒）与
  `publish-desktop-bundle.mjs` 同口径，用例 `tests/package-desktop-portable.test.ts`
  真打真解 zip 核对布局。规范 §7.7.2 / §9.5 / 两份 README 同批登记。
