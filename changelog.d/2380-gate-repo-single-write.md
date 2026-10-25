## Fixed

门禁夹具 `tests/helpers/gate-repo.ts` 把同一条路径写了两遍 —— Windows 节点上会留下一份
**NUL 填充**的脚本副本（`SyntaxError: Invalid or unexpected token`，报错指向临时目录里那一份，
读起来像判据坏了）。

`copy` 的整目录拷贝（`{ from: "scripts/lockfile", … }`）与依赖链按
`import "./lockfile/lock-diff.mjs"` 补齐的那一份**指到同一个落点**，于是那个文件被写两次；
无论谁先谁后都不安全（先依赖链再 `copy` 是现场那一形，反过来只是把雷埋到下一次加 import）。

改法落在「归属」而不是顺序：`files` / `copy` 先落并**拥有**它写过的路径（目录级认祖先链），
依赖链只补还没有人写过的那些，两条来路共用夹具里**唯一一处** `cpSync`。依赖链的自动补齐
与「用例自己写的夹具优先」两条语义不变。契约由 `tests/gate-repo-single-write.test.ts` 守着。
