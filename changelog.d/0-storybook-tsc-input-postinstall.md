## Fixed

- **新检出上第一个提交就会被提交门槛拦下**（台账 E15）：Storybook 注入层（`.storybook/data-sources.tsx`）读的两样东西都是**现生成、整目录 gitignore** 的 —— `./generated/app-origin`（应用端口按检出路径推导，写死的值在别人的 checkout 上必然错）与 `.storybook/assets/` 那三张示例图（media 值源要指向磁盘上的真文件名）。而 `tsconfig.json` 的 include 又显式列着这个点目录（点目录不在 glob 的默认展开范围里，不列就是 tsc 与 eslint 的双重盲区）。两份决定各自都对，合起来是「门槛依赖只有跑过 `pnpm storybook` 才存在的文件」：`pnpm typecheck` 报 `Cannot find module './generated/app-origin'`（钩子 A 组），`pnpm test` 报「sample-landscape.svg 不在 .storybook/assets/」（钩子 C 组），两条都指向谁都没碰过的文件，于是拦住的是从那份基线分出去的**每一次**提交（落库时全绿，因为作者的机器上那些文件在）。
  修法不动那条设计：把 `ensureStorybookAssets()` 与 `writeStorybookAppOrigin()` 两个幂等调用并进 `postinstall` 的唯一入口 `scripts/install-git-hooks.mjs`。不改 env 注入（Storybook 的 webpack 把 `process.env` 换成白名单对象，业务变量进不去、兜底永远生效 —— 那是注入层文件头记下的实测结论）；也不给 postinstall 再拼一条命令（`checkPostinstall()` 要求逐字以 `node scripts/install-git-hooks.mjs` 开头、禁止 `&&`）。失败语义与同入口的另两步一致：只提示，绝不让 `pnpm install` 挂掉。

## Changed

- `scripts/storybook-assets.mjs::figure()` 补上三个 `@param`：它被测试静态 import 之后进了类型程序（`checkJs` 打开），那三行隐式 any 是这次新照出来的。

## Tests

- **新增 `tests/storybook-tsc-input.test.ts`（进固定清单）判「保证链」而不是「文件在不在」**：后者机器相关、在干净检出上必红，等于又一处只能在某台机器上绿的判据。三条判据 ——① 消费方 import 的导出名与生成器实际产出的同一组（真把生成器跑到临时目录再解析：桩掉生成器就是拿自己写的期望证明自己）；② `postinstall` 入口里那句调用确实在 try 内、catch 说得出这一步没做成怎么办（按**调用形态**判而不是文件名，解构那行带同一个标识符）；③ 生成物仍然不入库（`.gitignore` 列着它，且 `git ls-files` 数出它没被提交）。②③ 互为前提：哪天改成入库，② 就该撤 —— 单向陈旧由这两条一起拦。两次变异各红各的：产物少一个导出名 → ① 红；把调用注掉 → ② 红（同时在场的一条挡住反证写成永真）。
