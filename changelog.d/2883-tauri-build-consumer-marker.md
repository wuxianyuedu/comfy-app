## Fixed

- **「这一档有没有真构建格」那张表认不出经 tauri 间接触发的那一格（ISSUE #2883）**。
  `BUILD_CONSUMER_MARKERS`（`tests/no-platform-ci-config.test.ts`）是 #2851 那条接槽安全前提的
  机器执行者 —— 「一条档后面有会真构建的格子 ⇒ 它的安装格不许接依赖缓存槽」（接槽把
  `node_modules` 接成指向项目根之外的 junction，Turbopack 对这一条有硬要求，#2081 那次
  13.8s 就死 + 后面整片 `skipped`）。它扫的是每格**真正执行的命令行**
  （`executableScriptLines()` 明写「丢掉空行与 shell 注释」）。三枚标记
  （`ci-daily-build.mjs` / `build-desktop.mjs` / `next build`）在桌包那一档上是**假阴性**：

  ```
  $ grep -n -A13 "^  - name: 打包·桌面成品构建" .cnb.yml | tail -2
  1321-      $env:Path = "$env:CARGO_HOME\bin;$env:Path"
  1322-      node scripts/ci-cp936-exit.mjs -- pnpm tauri build      ← 一个标记都不含

  $ grep -n beforeBuildCommand src-tauri/tauri.conf.json
  10:    "beforeBuildCommand": "node scripts/build-desktop.mjs"      ← 名字在这儿，不在那个扫描面上
  ```

  （`.cnb.yml` 那一格的注释也写着整条链 `beforeBuildCommand` → `build-desktop.mjs` → `pnpm build`，
  而**注释不是判据的输入面**。）更不容易发现的是它自己的自检是绿的：那条正例写的是
  理想形态 `node tools/build/build-desktop.mjs --release`，与现役配置那一行逐字不同 ——
  **判据在场，量程只覆盖夹具里那个形状**。这不构成今天的事故（那张表当时只被拿去判 push 那份
  清单），但 #2853 的期望 1 要做的正是「拿它逐档判断跑格接不接槽」，一执行就会替桌包档答出
  "可以接槽"，把那条安全前提摘掉。

  改的仍是判据、不是被测面（**不许**为了被认出来去改 `.cnb.yml` 那一行的写法）：

  - 标记面补 `tauri build`；
  - 那条自检加第四例，用的就是**现役那一行的原文**
    （`node scripts/ci-cp936-exit.mjs -- pnpm tauri build`），原话形态的直接调用例保留；
  - 再对**现役配置**判一次：按 `pipelineStageNames(text, "桌面成品包")` +
    `executableScriptLines()` 解析出的那份清单，必须扫得出 `打包·桌面成品构建` 是构建消费者
    —— 这一句才是上面那枚标记的执行者（只有夹具的话，标记加了也无人调用）；
  - 由它直接推出并钉住那条不变量：**`打包·安装依赖` 不许出现 `COMFY_CI_SLOT`**
    （要接得先证明 #2521 的 `turbopackAdditionalRoots` 在这一档跑得通，不是照别的档推）。
    先断言那一格解析得到（`toBeTruthy`）再断言它不含那个键 —— 否则格名一改，这条就退成
    一句恒真的空判。

  **变异证明**：把 `"tauri build"` 那一枚摘掉 ⇒ 该用例红，且红的是新加的那一条
  （`expected [] to deeply equal [ '打包·桌面成品构建' ]`，话术里写明了"拿这张表去判断跑的档
  接不接槽会摘掉安全前提"），其余 **45 条照常绿** ⇒ 这一枚标记没有别的执行者在撑它；
  还原后 46 条全绿。

  规范 §13.5.3.4.3 那段「扫 push 那六格的命令行」同步改写：标记清单补到四枚、扫描面那句
  「注释里出现的名字不进场」写明、并补上"这张表现在反向扫桌包档"这一整段因果
  （含 #2853 那条期望被这张表的量程救回的一次）。顺带清掉那句里的「**那六格**」现值 ——
  同一族、同一处置（条数不写进散文，要数就问清单本身，见 §13.5.17）。
  镜像 `docs/generated/13-提交与-code-review.md` 同批 `--only` 生成。

  验证：`pnpm exec vitest run --no-file-parallelism tests/no-platform-ci-config.test.ts` **46 条全绿**、
  `pnpm exec tsc --noEmit` 退 0、`pnpm exec eslint` 该文件退 0、`pnpm doc:check` 绿。
