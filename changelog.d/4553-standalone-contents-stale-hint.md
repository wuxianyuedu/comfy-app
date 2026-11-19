## Fixed

- 产物护栏（`check-standalone-contents.cjs`）在 static 层判到白名单外脚本、且这些路径在源码里已不存在时，现在会明确指出「`src-tauri/static` 是陈旧产物，先重建再判」（`node scripts/build-desktop.mjs` / `tools/build/rebuild-static.ps1`），不再只引导去登记白名单——后者会把人引向给源码里已不存在的旧布局发通行证，而 `build-desktop.mjs` 第 1 步依赖 `pnpm build`，陈旧 static 会让它卡在第 1 步、永远走不到刷新 static 那一步。（#4553）
