## Fixed

- **`浏览器安装` 红在同一个形态上七跑 —— 而根因不在「挑哪个下载根」上，在
  Playwright 自己那份下载没有续传**（ISSUE #1959 第七跑，现场 `cnb-vnu-1k51kes4k`）。

  前几笔一路收窄到「探测与装之间没有执行者」「HEAD 会把取不下字节的链路判成好链路」，
  `pickPlaywrightRoots()` 也接上了 —— 而这一跑里**三个候选根全部量得到**：

  ```
  装之前的探测    cdn.npmmirror.com → HTTP 206（实收 1901 字节）      （ok）
                  cdn.playwright.dev → HTTP 206（实收 589 字节）       （ok）
                  registry.npmmirror.com → HTTP 206（实收 15435 字节）（ok）
  playwright install  同一个根 → timed out after 120000ms，Download failure，3 个根 × 5 次
  ```

  挑根没有更好的根可挑。真因是上游 `browserFetcher.ts` 的每个 URL 重试
  `retryCount = 5` 次里，**每次失败都 `unlink(zipPath)` + `removeFolders(browserDirectory)`，
  从第 0 字节重来** —— 一条「能握手、能吐前几 KB、然后在大 body 上停住」的链路
  因此永远到不了 114 MiB 的尽头，换多少个根都一样。

  修法是**自己分片取字节**，与 Playwright 那条路并存（`ci-toolchain-browser-fetch.mjs` +
  `ci-toolchain-browser-seed.mjs`）：

  - 整包切成固定大小的片，每片一次**独立**的 `Range` 请求、带自己的超时与重试；
  - 片长**自适应**：一片走不完就把片长减半（下限 16 KiB）再试 —— 一条每次只稳吐
    20 KB 的链路因此不是「永远失败」，而是「多几轮」；
  - **已落盘的字节一个都不动**（片先落 `<dest>.part`，整片走完才接到 `dest` 上）：
    这正是与 Playwright 那条路的关键差别，也是「续传」成立的前提；
  - 成功即写好上游那份 `INSTALLATION_COMPLETE` 标记，`playwright install` 随即变成
    no-op；失败则一个字都不改，原样交给老路 —— **它是尝试，不是判据**，
    放行仍是 `browserExecutableExists()`（按落点看东西在不在）。

  途中修掉三个会让「看着成功、其实白做」的坑：

  - **落点目录名用 `revision` 不是 `browserVersion`**：拿错一个号的形态是包解到一个
    没人会看的目录，Playwright 随即 `Removing unused browser` 整包重下一遍
    （自取白做，而日志两个方向都像成功）。两个号都由 `readPlaywrightBrowserTarget()`
    一处读出来（这一支此前只回了前者）；
  - **zip 解压不再押 Windows 自带的 `tar`**：GNU tar 对同一个包直接报
    `This does not look like a tar archive`，而这一步是全平台的。改成自己读 zip 的
    central directory（只认 `0` 原样 / `8` deflate 两档，无 zip64），按
    `external_attr` 复原权限位（headless shell 缺了它会在 POSIX 上以 EACCES 收场）；
  - 单文件 900 行的硬闸（§12.6 R5）逼出按职责拆：编排层单独一份
    `ci-toolchain-browser-seed.mjs`。

  判据在 `tests/ci-toolchain-selfcheck.test.ts`（7 条）：分片那一条起一个
  **只吐固定字节数就挂起**的假链路（服务在**子进程**里 —— 分片取字节是 `spawnSync`
  起的，在同一进程里起服务必然连不上），判「整包逐字节等于声明长度」（少了收尾没接上、
  多了说明失败那一片的半成品被留在文件里）、判「片长退档」、判「已落盘前缀不被重下」；
  zip 那一条既判结构（不许回到 `tar -xf`）又判行为（造一个真 zip 解出来逐字节对上）。
