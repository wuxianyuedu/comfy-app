## Fixed

- **同卷这件事有两条，原先只判了一条**（ISSUE #2022 第二步，规范 §13.5.3.4.3）：
  槽 ⇄ store 同卷管的是硬链接（破了只是悄悄变贵，没有红）；**槽 ⇄ 作业检出**同卷管的是
  能不能用 —— 作业里的 `node_modules` 是指向槽的链接，于是「往 `node_modules` 里挪一个文件」
  这类 `fs.renameSync` 在跨卷时直接失败。实测红法（别人的一条用例，不是本仓任何一处缓存代码）：

  ```
  EXDEV: cross-device link not permitted,
  rename '<G:>\…\workspace\.storybook\generated\app-origin.json'
      -> '<G:>\…\workspace\node_modules\.cache\sb-generated-9284\app-origin.json'
  ```

  成因就是 #2049 那批写死的盘符：runner 搬到 `G:` 之后作业在 G:、槽根还钉在 F:。
  上一批把根改成推导，顺带满足了两条（`pnpm store path` 随 cwd 变，作业在哪个卷、
  store 与槽就在哪个卷）；这一批补的是**守卫**：`planSlot` 多一档 `sameVolume`，
  为假 ⇒ `no-cache` 且那句话把 EXDEV 的后果写进去，读数与执行共用这一个判断。
  显式 `COMFY_CI_CACHE_ROOT` 那个换盘出口仍然留着，但它现在会被这档拦下并打印原因 ——
  而不是把一次选址错误变成别人用例里一条看不懂的跨卷红。

- 判据：`tests/ci-cache-slot.test.ts` 三条（同卷/跨卷判定、跨卷 ⇒ no-cache 且点名 EXDEV、
  没给这条事实时不拦）+ `tests/ci-slot-apply.test.ts` 一条端到端（槽根在别的盘 ⇒
  不装、不建链）。另修一处测试地基：`tmpRoot()` 原先落在 `os.tmpdir()`（C:），
  与本仓（F:）跨卷 —— 新守卫一上，那两档「槽不在 / 槽命中」的读数用例会被判成 no-cache，
  看起来像判据坏了。现在临时槽根落在**与仓库同一卷**的卷根下，也正是生产推导出来的同一层。
