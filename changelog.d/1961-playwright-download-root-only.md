## Fixed

- **「浏览器安装」第四次红：给上了下载根，却还去试它替不掉的那一族**（ISSUE #1961）。

  现场（`cnb-g9d-1k515kvrq`）：

  ```
  下载根由 PLAYWRIGHT_DOWNLOAD_HOST 指定：https://cdn.npmmirror.com/binaries/playwright
  Downloading … from https://cdn.npmmirror.com/binaries/playwright/…/chrome-win64.zip   ← 同一个根逐字两条
  Downloading … from https://cdn.npmmirror.com/binaries/playwright/…/chrome-win64.zip
  Failed to install browsers | … timed out after 120000ms
  ```

  上一笔把 `PLAYWRIGHT_DOWNLOAD_HOST` 设成「给上了就**只用它**」，但那条意图只落在
  `playwrightHostsToTry()` 的返回值上 —— `runPlaywrightInstall()` 拿它当「按序试两个根」，
  于是**外面给的那个 + `undefined`（= Playwright 内置那一族）逐次都起了一遍**。
  而那一族正是这个根替不掉的：实测 `5 × 120s` 全落在 `*.playwright.dev`，
  多试一次不是多一条出路，是把同一次不通再花一遍时间。

  真正贵的是它**把两档读数搅坏了**：`playwrightInstallHints()` 分「同族被反复试」与
  「慢链路上没量完」，靠的是试过的根里有没有非 Playwright 族的。多出一个 `undefined`
  之后前者的判据再也不成立，日志把人引回「把超时再改大一点」——而这一步的处置恰恰相反。

  修法：把「试哪几个根」与「没设时回落到谁」分成两个问题 ——
  `playwrightDownloadRoots()` 说**这一趟起几次进程**（设了就恰好一次，没设就一条空宿主，
  交给 Playwright 自己的三档），`playwrightHostsToTry()` 保留原不变量
  （设了就 `[configured]`、没设就 `[undefined]`，**本仓不替它挑第三方镜像**）。

  判据：设了根就 `playwright install` **恰好起一次**、且用的就是它
  （反向复算过：把循环换回「总去试」，判据当场点名）。⚠️ 只钉两个函数的返回值不够 ——
  那样把 `playwrightDownloadRoots` 换回 `playwrightHostsToTry` 仍然全绿、行为却回去了，
  所以这一条判的是**真响了几次**。

  ⚠️ **还有一半不在本仓**：修完这一笔，这一步红才是**对的读数**（「这台节点到不了这个根」），
  所以需要平台侧的下一步 —— 那个镜像根要么换一个**这台节点真能到**的，
  要么走内网代理（见规范 §13.5.3.5.1 第 ⑥ 条）。
