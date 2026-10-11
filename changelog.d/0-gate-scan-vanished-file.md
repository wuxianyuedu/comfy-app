## Fixed

- **三条「测试层」判据不再因为一份并发探针而整机崩掉**（`check-test-sleep.cjs` /
  `check-test-waitfor.cjs` / `check-test-it-each.cjs`）。现场：本仓提交被 D 组拦下，
  报错不是站点而是 Node 栈 ——
  `Error: ENOENT: no such file or directory, open '…\tests\.setup-cleanup-probe-244724-1791606669965.test.tsx'`，
  指向的文件谁的改动里都没有。根因是这三条都按 `walk()` 列 `src`/`tests`/`e2e` 再
  逐个 `readFileSync`，而 `tests/global-setup-cleanup.test.ts` 会在 `tests/` 下**临时造**
  `.setup-cleanup-probe-<pid>-<ts>.test.tsx` 再删掉 —— 同一份工作树里有两个 vitest 在跑
  （并行会话，或本钩子的 C 组还没退干净）时，扫描就落在「列到名字、读时已经没了」那个
  窗口里。`.test.tsx` 恰好命中三条判据的扫描面，所以**每次并发提交都会撞**。

## 口径

- **消失 = 返回 `null`，由调用方计数**，不是抛、也不是静默跳过：一个已经不存在的文件里
  没有站点可言（不该算违规），但「这一轮有 N 份没读到」必须让看的人知道 —— 静默跳过就是
  §13.5.12 那一族「判据自称在跑、实际没跑」的入口。三条判据的结论行都追加了
  `⚠️ 另有 N 份文件在扫描期间消失（并发用例的临时探针），本轮未读`（N=0 时一个字不打，
  普通提交零噪声）。
- **没动扫描面、没动基线、没动任何棘轮数字**：三条判据在本仓当前树上一处站点都不报，
  改的只是「读不到时怎么办」。
- **只收了这三条**，其余留给下一刀 —— 但**这一段原先给的数是错的**，按下一刀的统一口径重测后改写如下。
  原文写「扫描面含 `tests` 的判据共 15 份，其中同形状的 9 份…后来剩 7 份」：`9` 与 `7` 都站不住，
  错在**判据不同一** —— 那一次量的是「有没有同一段读文件代码」，既漏算了「枚举 `tests` 但读法不同」的
  `check-comment-language` / `check-gate-executors` / `check-tsc-diagnostic-executors`，
  也没区分「有私有容错」与「容错是静默的、不计数」。统一口径 = **谁在枚举 `tests/`**：
  人口 **15**；其中已有私有 `ENOENT → null` 容错 **5** 份（含本条收掉的 `check-test-todo`
  与 `4887f1f1`/`#1665` 收的 `check-annotate-consumer`）、读那一步完全没有兜底 **7** 份、
  枚举那一步 `catch` 掉所有错误的静默降级 **3** 份。
  这条尺现在是**机器枚举**的，不再是人数名单：`tests/gate-scan-read.test.ts` 的探测器 A 每次跑都把
  这 15 份现算一遍，并带一条地板（`>= 15` + 锚点 `check-test-sleep.cjs` 在场）证明探测器自己没漂。
  **所以这个数将来会被改短或改长，别从这里引用** —— 现跑：
  ```bash
  node -e '
  const fs=require("node:fs"),path=require("node:path");
  const src=(n)=>fs.readFileSync(path.join("scripts",n),"utf8");
  const hits=(s)=>/SCAN_DIRS\s*=\s*\[[^\]]*"tests"/.test(s)||/walk\w*\(\s*path\.join\(\s*ROOT\s*,\s*"tests"\s*\)/.test(s);
  console.log(fs.readdirSync("scripts").filter(n=>/^check-.*\.cjs$/.test(n)&&hits(src(n))).length);'
  ```
  （实测这条现在给 **15**。同一份 `HEAD` 树上跑上一版那句 `grep -c 'readFileSync(abs'` 给的是 **7**
  —— 差的 8 份里有 5 份是「已经有私有容错」（被那条尺正确排除），**3 份是漏的**：
  `check-comment-language` / `check-gate-executors` / `check-tsc-diagnostic-executors`，
  而它们当时被一句「扫 `tests` 但不是这个读法」放走了。**漏的这 3 份里有 2 份是静默吞掉所有错误**
  （`catch { continue }` 且不计数），比裸读更糟 —— 这就是「按代码形状定口径」的代价：
  尺子量的是长相，不是「读不到时会怎样」。）

  **另一刀已经落地**（`0-gate-scan-read-shared.md`）：15 份全部收进共用件 `scripts/gate-scan-read.cjs`，
  私有副本清零，回潮由 `tests/gate-scan-read.test.ts` 的两条形状拦。当年写下的取舍是
  「要么按现场逐条收（`#1665` 走的就是这条），要么一次收完并给那份共享读取器配它自己的判据与用例」——
  走的是后者。**两边都得能答出「读不到的时候，谁在数」这句没变，变的是答案现在只有一份。**

## 验证

| 项 | 结果 |
| --- | --- |
| 三条判据在干净树上 | 各自 OK，输出与改前逐字一致（无消失 ⇒ 不打那一行） |
| `tests/test-{sleep,waitfor,it-each}-gate.test.ts` | 31 passed（每份各 +1 条新用例） |
| **变异复核** | 摘掉 `check-test-it-each.cjs` 的那条 `ENOENT → null` ⇒ 新用例当场红在 `Error: ENOENT …`；装回即绿 |
| 用例形态 | 走**进程内**调用导出的 `scanFile`，不在临时仓库里造「删文件的时机」—— 那是一次概率窗口，判据不许长在上面 |
| `tsc --noEmit` / `eslint` / `prettier --check` | 0 error / 0 warning / 干净（只点名本次改的文件） |
| `.githooks/pre-commit` | 见下方提交 |
