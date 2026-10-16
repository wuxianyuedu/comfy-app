## Fixed

- **浏览器落点根用宿主的 `path.join` 拼 —— 平台侧 `单元测试` 只红这一格**
  （ISSUE #1961）。

  读数（`cnb-3tg-1k5126kcf`，`Test Files 1 failed | 759 passed`）：

  ```
  FAIL tests/ci-toolchain-selfcheck.test.ts > 装完必须复验 > 落点根按平台推
  AssertionError: expected '\h\Library\Caches\ms-playwright' to be '/h/Library/Caches/ms-playwright'
  ```

  `playwrightBrowsersRoot` 的 `platform` 是可注入的，所以它会**在一种平台上判另一种
  平台**（这组用例正是这么用的）。而拼路径用的是宿主那份 `node:path`：Windows 节点上
  拼 `darwin` 得到全反斜杠的 `\h\Library\…`，Linux 上拼 `win32` 得到
  `D:\Users\ci\AppData\Local/ms-playwright` —— 判据跟着**跑判据那台机器**变。

  修法：按**目标平台**取 `path.win32` / `path.posix`（`browserExecutableExists` 与
  递归查找一并走同一个 join）。这与 `executable-resolve.ts` 那句「大小写不敏感只按
  目标平台」、以及 `ci-toolchain-python.mjs` 的 `pathDrives` 记过的「按目标平台的分隔符
  切 PATH，不按宿主的」是同一条口径。

  用例那半边同样修了：期望值原先也拿宿主 `path.join` 拼（同一个病的另一半），
  改成按目标平台拼。反向复算：把实现退回宿主 `path`，「落点根按平台推」当场红。

- 顺带修一处**指不到实处的引用**：`scripts/ci-toolchain-browser.mjs` 的头注点名
  `tests/ci-browser-selfcheck.test.ts`，而那个文件不存在 —— 守住这一层的是
  `tests/ci-toolchain-selfcheck.test.ts` 的「装完必须复验」那一组。注释里指向一个
  不存在的文件，比不写更坏：下一个人会以为那一层有人守着。

- 再顺带清掉 `scripts/ci-toolchain-browser.mjs` 里**一段悬空的重复 JSDoc**：文件头那段
  叙事（「为什么是装而不是判红让人去装」）在文件里又原样出现了一遍，末尾还挂着
  `@returns` —— 那份 JSDoc 后面**没有函数**，它只是把同一段话说了两遍。删掉重复的
  那一份，函数留下带「注入面」的那份。
