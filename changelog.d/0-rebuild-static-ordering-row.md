## Added

- `launch-and-build.md` §5 排障手册补一行「想修 `src-tauri/static` 的红，却发现从任何一侧都进不去」：
  `pnpm build` 因 `[static]` 报白名单外条目 + 必备件缺件而 exit 1，而 `build-desktop.mjs` 的
  1/4 第一步正是跑 `pnpm build` —— 两侧互为前提。根因是**装配顺序**（判据只要
  `static/server.js` 在就把那层当真产物逐条判，半截装配必然红），不是判据坏了。
  出口是 sanctioned 入口 `tools/build/rebuild-static.ps1`：**先清再建**。
  按「维护约定」：踩到新的构建/产物故障，先写进 §5 对照表。
