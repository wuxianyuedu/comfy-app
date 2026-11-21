## Fixed

- 门禁自测夹具 `tests/helpers/gate-repo.ts`：用例显式 `copy:` 拷入沙箱的文件（含整目录的每个文件）现在也作为种子进 `copyGateDeps` 的依赖扫描队列——显式拷一件 = 它的仓库内传递依赖自动闭合，不再要求把链上的文件逐个手补进 `copy:`。此前显式拷入的文件不被续追依赖，判据经动态 `import()` 引入的模块一旦又静态 import 别的仓库内模块，沙箱里就是 `ERR_MODULE_NOT_FOUND`、读起来像门禁坏了（同族坑：#4654 手补 `log.mjs`、#4688 手补六件，第二次以更大面出现）。`tests/on-demand-duties-gate.test.ts` 据此删掉手补的拷贝项，只留判据动态 `import()` / 按文本读的三份直接输入。（#4691）
- 同夹具的沙箱 `package.json` 边界标记补 `"type":"module"`，与真仓库同形：沙箱里的 `.ts` 依赖（`executable-resolve.ts` 一族）按 ESM 直载，不再触发 Node 26 的 `MODULE_TYPELESS_PACKAGE_JSON` 警告——该警告走 stderr，而 `run()` 在退码非 0 时合并两路流，JSON 报告后面多出警告正文的直接后果是 `deps-freshness-gate.test.ts` 的 `--json` 契约组整组 `JSON.parse` 红（本轮 PR 的 GA `test-gates` 现场之一）。（#4691）
