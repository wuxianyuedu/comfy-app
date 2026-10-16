## Fixed

- **`浏览器安装` 这一格连着两个「绿着不干活」，第二个还把第一个的修法一起废掉了**
  （ISSUE #1961）。两个都是实测出来的（删掉 `chromium_headless_shell` 再跑
  `node scripts/ci-toolchain-selfcheck.mjs --playwright-only`），两个的形态都是
  「报了成功、实际什么都没做」——比直接红难过得多。

  **① 装完没复验**：`playwright install` 是一条**下载**命令，有三种「退 0 但东西
  没落地」的形态 —— 传输被截断、落点不可写、**CDN 回了一份错误页**（HTTP 200 的
  HTML，Playwright 不解析它，于是既没报错也没装上）。自托管节点是台长期存在的机器，
  盘满与代理拦都不稀奇。现在装完按落点找一次那个 headless shell
  （`browserExecutableExists()`，按**形状**找、不写死 revision 号 —— 那个号随
  Playwright 版本漂），找不到即非零退出并把落点读数打出来。与
  `installAndReverify()` 的「装完回到 `findPython()` 再探一遍」同一条口径：
  **装与判是两件事**。

  **② 退出码被守卫吞掉**（这一条更要紧）：脚本末尾那个「是不是被直接执行」的守卫
  此前是裸 `main();`，而 `main()` 的返回值**就是**退出码 —— 于是
  `--python-only` / `--playwright-only` 里那些 `return 1` 全部被吞，进程**恒退 0**。
  实测：复验判不过、话术一字不差地打了「报了成功，但那一件二进制不在盘上」，
  **退出码仍是 0**。也就是说 `Python 可用性` 与 `浏览器安装` 这两步**存在的全部
  意义就是「缺件时红」**，而它们从来红不了 —— ①那个修法因此在平台上等于没上。
  修法一处：`process.exit(main())`。

  同一天还清掉同一格的第三条（`pnpm -v` 被接到真命令上，见
  `1961-ci-playwright-install-probe-args.md`）—— 三条合起来才是「这一步真的做成了
  那件事」。判据在 `tests/ci-toolchain-selfcheck.test.ts`（49 条），**三条都反向
  复算过**：把 bug 形态放回去，判据当场点名。规范 §13.5.3.6 补一条 ⚠️ 记下这三个坑。
