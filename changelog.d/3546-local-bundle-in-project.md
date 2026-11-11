## Changed

- **本地一键打包直落项目内 `dist\desktop`，不再写常驻目录**（#3546）：`tools/build/build-all.ps1`
  的发布那一格改为 `node scripts/publish-desktop-bundle.mjs --root <项目根>\dist\desktop`，
  本机自己打的安装包留在检出里（`/dist/` 已在 `.gitignore` 与 `scripts/qoder-ignore.mjs`）。
  发布入口新增 `--root <dir>` 旗标，优先级高于 `COMFY_CI_ARTIFACT_ROOT` 与 `pnpm store path`
  推导 —— 不传它时行为一个字没变（一份一个目录 + `manifest.json`、`latest.txt` 指针、
  轮转留 2 份、三态退出码全部照旧），变的只是根。
