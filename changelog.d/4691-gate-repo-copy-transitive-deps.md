## Fixed

- 门禁自测夹具 `tests/helpers/gate-repo.ts`：用例显式 `copy:` 拷入沙箱的文件（含整目录的每个文件）现在也作为种子进 `copyGateDeps` 的依赖扫描队列——显式拷一件 = 它的仓库内传递依赖自动闭合，不再要求把链上的文件逐个手补进 `copy:`。此前显式拷入的文件不被续追依赖，判据经动态 `import()` 引入的模块一旦又静态 import 别的仓库内模块，沙箱里就是 `ERR_MODULE_NOT_FOUND`、读起来像门禁坏了（同族坑：#4654 手补 `log.mjs`、#4688 手补六件，第二次以更大面出现）。`tests/on-demand-duties-gate.test.ts` 据此删掉手补的拷贝项，只留判据动态 `import()` / 按文本读的三份直接输入。（#4691）
