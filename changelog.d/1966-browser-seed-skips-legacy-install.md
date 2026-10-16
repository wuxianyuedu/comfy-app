## Fixed

- **`浏览器安装` 的第一跑：自取把 119 MiB 走完了，红的是老路顺手要拉的 ffmpeg**
  （ISSUE #1966，现场 `cnb-7oo-1k51r518b`）。

  读数逐字如下（2m12s）：

  ```
  自取：从 https://cdn.npmmirror.com/binaries/playwright 分片取这一件（可续传，断了接着来）
  自取成功：…\ms-playwright\chromium_headless_shell-1243\…\chrome-headless-shell.exe
  Downloading FFmpeg (playwright ffmpeg v1011) from …/builds/ffmpeg/1011/ffmpeg-win64.zip  × 5 次
  Error: Request to …/ffmpeg-win64.zip timed out after 120000ms
  Error: Download failure, code=1  →  浏览器装不上（`playwright install` 退非零）…
  ```

  即「怎么取」那一半**被证实了**（分片自取在这台节点上真走完了那 119 MiB），
  而红的是**另一件**：`playwright install` 不只装浏览器，还会顺手拉 **ffmpeg**
  （chromium 的依赖，~2.5 MB），而那件在同一条链路上照旧 0 字节 —— 于是整格红在
  一件**已经装好的浏览器**旁边。

  处置：这一步在自取成功之后**再按落点复验一次**（同一个 `browserExecutableExists()`），
  通过就直接放行、不再交给老路。本档真正要的是 headless shell（复验找的就是它），
  而 ffmpeg 只有录视频才用得上（`playwright.config.ts` 没开 `video`）。
  **不是放宽判据**：放行条件仍只有一条，新增的那次复验确认的是同一件事。

  同批订正规范 §13.5.3.5 里那句已经过期的话 ——「写好 `INSTALLATION_COMPLETE` ⇒
  `playwright install` 是 no-op」**不成立**（它是按「install 只装浏览器」推的）。

  ⚠️ 实现那一行只有一行、没有第二段注释，因为 `ci-toolchain-browser.mjs` 改动后
  正好 **900 行**（闸是「> 900 阻断」）：这份文件已经到顶，下次要加东西先按
  §12.6 R5 拆。理由与读数写在 `ci-toolchain-browser-seed.mjs` 的头注与规范里。
