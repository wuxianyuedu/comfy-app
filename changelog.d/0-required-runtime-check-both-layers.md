## Fixed

- **产物层「必须有的」那条反向检查只数了构建目录，没数出厂那一份**
  （`scripts/check-standalone-contents.cjs`、规范 launch-and-build §7.4、AGENTS 硬规则 18）：
  `REQUIRED_RUNTIME_FILES` 三份 Next 运行时脚本原来挂在 `if (label === "standalone")` 下，
  而最终被**编译期内嵌进 exe** 的是 `build-desktop` 组装后的 `src-tauri/static` ——
  整树 `dereference: true` 拷贝与白名单剪枝**全部发生在那次检查之后**。
  缺 `app-route-turbo` 在 exe 里的表现与在构建目录里一模一样（页面正常、接口全 500），
  所以「构建期过了」根本推不出「出厂件也在」；这一条恰好是 §7.4 花最大力气防的那个形状，
  却只防了一半。
- **提缺件的前提从「按 label 挑一层」改成「这一层真的是个产物」（目录里有 `server.js`）**，
  与 §7.5 宿主那三件的判据一致：开发机上 `src-tauri/static` 常只剩几个入库例外文件，
  对那种半成品目录报「缺件」只会把人指到错的地方。
- 抽出 `missingRequiredRuntimeFiles(dir)` 并与 `checkDir` 一起导出，**缺件判定第一次
  变成可被测的东西**（原来它是 `checkDir` 里一段带条件的内联表达式）。

## Added

- `tests/dist-artifact-hygiene.test.ts` 的 `it()` **20 → 23**，三条分别钉住：
  ① 齐件判 0 缺、少一件就点名那一件；② **同一份缺件目录 label 传 `"static"` 也必须报**，
  并带一条反向对照（把件补齐即放行，证明不是恒红）—— 判据落在**行为**上（真调用 `checkDir`
  并捕 `console.error`/`console.log`），不写「源码里还有没有那个 `if`」的结构断言，
  因为结构断言在别人换一种写法时会无谓变红、或在检查真的被删掉时无谓变绿；
  ③ 两个计数口径的分工（「必须有的」穿符号链接按可达判，「不该有的」按真文件判）。
- **这条用例不是空转，用变异测试当场验过**：临时把 gating 还原成 `label === "standalone"`
  再跑本文件 → 那条 static 用例即红（`expected false to be true`），还原回来 → 23 过。

## 存量与验证

- 本机实测扩展**没有新增红**：`src-tauri/static` 里那三份 `*runtime.prod.js` 都在，
  `[static]` 一条运行时缺件都没报；该组仍报的那批（14 个门禁脚本、472 份文档、24 个测试文件、
  宿主三件缺…）属于一份 2026-09-01 的陈旧组装自身的问题，未跟踪、不在 pre-commit 与
  `check:all` 链路里，下一次真跑 `build-desktop` 会由 #1220 那份实现连同形状一起清掉。
- `[standalone] ✓ 产物干净（13808 个文件）` 维持不变。
- `pnpm exec tsc --noEmit` 0 错、eslint 0 报；`vitest run` 本文件 + 相邻两份（
  `turbopack-tracing-excludes` / `standalone-runtime-completeness`）串行 **52 过**。
  `node --check` 两份脚本语法过；pre-commit 全部门禁过。
