## Fixed

门禁夹具 `tests/helpers/gate-repo.ts` 把同一条路径写了两遍，Windows 节点上会留下一份
**NUL 填充**的脚本副本（读起来是 `SyntaxError: Invalid or unexpected token`，
报错指向临时目录里那一份，像判据坏了）。

`copyGateDeps()` 先按 `import "./lockfile/lock-diff.mjs"` 逐个补文件，紧接着
`copy: [{ from: "scripts/lockfile", … }]` 又用 `cpSync` 整目录覆盖掉同一个落点；
`cpSync` 覆盖刚写过、句柄未刷完的文件时读回 NUL 填充。改成 `copy` 先落、
`copyGateDeps` 后补 —— 它已有「已存在的目标不覆盖」的守卫，于是同一条路径只写一次，
而传递依赖照旧遍历补齐（守卫只管不覆盖，不管不遍历）。
