## Fixed

- **让 `pnpm check:all` 在 Windows 无开发者模式下不再假阳**（类型安全审查 ·
  技术债盘点 #9 收尾）。三处红都是「测试夹具搭不起来」的环境噪声、不是门禁
  本体有 bug：
  · **`tests/check-format.test.ts` + `tests/check-reformat-only.test.ts`**
  ——`beforeEach` 里用 `fs.symlinkSync(文件)` 挂 `scripts/launcher-core/shell.mjs`
  到临时工作区。Windows 下 `fs.symlink` 需要开发者模式或管理员，普通开发
  者 100% EPERM。改成 **`cpSync` 递归拷贝整个 `launcher-core/`**（9 个
  `.mjs`、<50 KB）——不能只拷 `shell.mjs` 单文件，它 `import "./command-echo.mjs"`
  同级依赖会 exit 2。目录链接的两处（`node_modules` 与 `prettier-plugin-tailwindcss`）
  加一个 `symlinkSafe` helper：Windows 走 `"junction"`（NTFS 内建的目录链接、
  不需要特权、语义等价），其它平台保持 `"dir"`。21+17=38 用例全过。
  · **`tests/dev-launcher-port-reclaim.test.ts`**——`spawnSync("node",
    ["--input-type=module", "-e", script])` 里，`script` 内插了
  `import ... from "F:\\..."`。Windows Node ESM loader 只吃 `file:`/`data:`/
  `node:` scheme，绝对路径盘符会被当成协议 `f:` 直接
  `ERR_UNSUPPORTED_ESM_URL_SCHEME`。改成 `pathToFileURL(...).href` 再塞进
  `JSON.stringify`，Windows / macOS / Linux 一致。9 用例全过。
  与「环境非 hermetic」的另一族（本机跑多副本时端口探测命中别的检出、
  `target/release/app.exe` 占用 `check-file-structure Build-Guard`）不同，这
  三处**不需要**任何外部条件、纯代码修，改完 Windows 开发者上手第一天跑
  `pnpm check:all` 不再看到无解的红。
