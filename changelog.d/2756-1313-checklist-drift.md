## Fixed

- **§13.1「本地提交前必须通过」那份清单漏了 `check-eslint-exemptions.cjs` 一格**（单子
  #2756）：`fa73d1f8` 把这条判据接进 `.githooks/pre-commit` 的 D 组，却没有同批把它写进
  `docs/standards/13-提交与-code-review.md` 的 §13.1 清单 —— 而「清单 ⇄ 钩子 D 组逐字
  一致」本身有判据（`check-doc-references.cjs`），于是**从那次合并起** `doc:check` 在
  干净树上就是红的，`tests/check-doc-references.test.ts` 的 15 条连带全红（它每次调
  `runCheck()` 都读同一份输出）。
  本次把那一格补进清单（连同它的口径：只判「多登记 / 陈旧豁免」一个方向、取数用规则本体、
  没跑成退 2），并按 §13.5.5 用 `pnpm run doc:render -- --only <那一份源>` 同批更新镜像。
  没有改任何判据：`doc:check` 一个字都没动，它本来就是对的。

- **脚本档 tsc 棘轮的账本「面」落后一格：215 → 216**（同一张单 #2756）：#2751 新加了
  `scripts/affected-launch-file-timing-report.mjs`，而 `scripts/.scripts-typecheck-baseline.json`
  的 `face` 还停在 215 —— `tests/scripts-typecheck-ratchet.test.ts` 的「面 ⇄ 账同数」当场红，
  并且**红得指不出是谁**（它只给「展开 216 / 账上 215」两个数，而当时的 `driftReading()`
  是去问 `git ls-files` 的：差异只在**未提交**时才是「不在 git 清单」，所以这份读数只对
  提交那一刻成立）。按判据自己的指路收紧账本（实测 216 份 / 0 处）。

- **同一个用例文件里那两处 `git` 调用绕过了夹具隔离件**（同一张单 #2756）：
  `tests/helpers/git-sandbox-env.ts` 的文件头已经把这件事写过一遍（「宿主全局开了签名时，
  临时仓库要造得出提交」「修法不是在每个调用点补 `-c commit.gpgsign=false`」），而这个
  文件后来新加的「真 git 夹具」又手抄了一遍 `-c user.email/user.name` 三连、**漏了签名开关**。
  本地读数：同一句 `git commit` 带 `-c commit.gpgsign=false` 过、不带就死在
  `error: gpg failed to sign the data` ⇒ 那是一层「依赖宿主配置」的红（CI 绿、配了签名的
  机器红）。两处（`git()` 夹具与 `driftReading()` 的取数）现在都走 `gitSandboxEnv()`。
