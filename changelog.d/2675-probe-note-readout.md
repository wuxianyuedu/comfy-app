## Fixed

- **读数取不到时那句原因终于被念出来（ISSUE #2675）**：`scripts/ci-probe-lock-readout.mjs`
  的 `Reading.note` 此前**写进对象而没有读者** —— `emptyReading()` 写它、成功那一路写空串，
  而打印那一圈只念 `sn` / `status` / 四个时刻 / `title`，外部调用方（`ci-build-readout.mjs`、
  `.cnb.yml`）全文不出现 `note`。函数头那句「附一句原因（不静默、不冒充绿）」因此是一句
  **没有执行者的自我声明**：拿读数的人看到的只有 `status=(取不到)`，分不出「响应不是 JSON」
  （⇒ 去看 `-v` 那一路打了什么）与「响应里没有 data」（⇒ 那个 sn 不存在）——
  这两句的下一动作完全不同，而失败路径的出口因此少了一半。

  修法按单子里的第 1 案（念出来，不是从形状里删掉）：新增 `formatReadingRow()`，
  `note` 非空时以 `（…）` 缀在**同一行**行尾 —— 与 `scripts/ci-token-scopes.mjs:437`
  那一族同形（`const note = r.note ? \`（${r.note}）\` : ""`），空串那一支不造出 `（）`，
  否则「有原因」与「没原因」在屏幕上又长成一个样。

  **取数那一格顺手有了出口**：`report(repo, sns, readRow?)` 的第三个参数默认打真平台，
  用例喂进一份「取不到」的读数即可判屏幕上那一行。这不是为可测性加的抽象 ——
  不加它，这条只能写成「源码里有没有 `note` 这个词」，而那正是 ISSUE #2660 记的那一族
  （整档字面量断言：邻近等价改写判红、字面量落在别处假绿）。

  凭据（四条都跑了）：新用例 `tests/ci-probe-note-readout.test.ts` = **4 条全绿**
  （正向「行尾带得上原因」/ 反向锚点「成功那一路不出空括号」/ 三行互不相同 /
  「逐对相交与还没到终态那两行照旧打」）；**变异实测**把 `note` 的拼接压成空串后
  **2 条转红、2 条照常绿**（该红的红、不该红的绿，说明这一格判的是行为不是形状），
  还原后复跑 4 条绿；脚本档 tsc 复算仍是 **170 处 / 15 份**（本笔没有新格、也没有借
  `--update` 登记任何东西）。

- **顺带量到、另立一张单**（不在本笔顺手改，那是改取数不是改打印）：
  **ISSUE #2690** —— 那张单正文里承诺的第三种原因「cnb 起不来」**根本没有写入口**：
  `readBuild` 的 `execFileSync("cnb", …)` 不在 `try` 里（那个 `try` 只盖 `JSON.parse`），
  实测本机 `node scripts/ci-probe-lock-readout.mjs report …` 直接 `spawnSync cnb ENOENT`
  崩掉（`EXIT=1`，把 `node_modules/.bin` 加进 PATH 也一样 —— `spawnSync` 在 Windows 不按
  `PATHEXT` 找 `.CMD` 垫片）。仓库里早有可用的那一格（`scripts/ship-exec.mjs` 的
  `makeRunner()` 把起不来收成 `{ status: -1, error: "ENOENT" }`），修法是复用它而不是
  再写一份垫片解析。
