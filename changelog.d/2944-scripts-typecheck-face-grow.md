## Fixed

- **脚本档棘轮的面只拦「收缩」不拦「扩张」—— 判据自己打 ✓、用例判红，两处读数相反**
  （ISSUE #2944）。现场读数（2026-11-01，PR #2944 的 `固定结构用例` 那一格）：

  ```
  判据  node scripts/check-scripts-typecheck.cjs
        → ✓ 判决面 230 份 / 存量 0 处（基线 0）        （退 0）
  用例  tests/scripts-typecheck-ratchet.test.ts
        → AssertionError: 配置展开 230 份，账上写 229  （红）
  ```

  根因：上一笔（#2944）给判据补的「面收缩也要红」只写了 `<` 那一半。而**面涨了 1 份**
  时，若新入库的那份脚本一个错都没有，存量那一圈（`grows`）一个格子都不涨 ——
  `face` 于是成了唯一本该开口的账面信号，却因为判据只判 `↓` 而保持沉默。真现场正好是
  这个形状：`#2948` 在主干新增 `scripts/suspended-gate-tests.mjs`，谁都没跑 `--update`，
  判据报绿而用例报红，红只落在下一个动脚本的人身上。

  修法：判据把 `face.length !== baseline.face` 当红（两个方向各自一句话说清因果），
  位置放在 `grows` **之后** —— 新脚本带了错时先念「新写的脚本零容忍」那一句（更具体的因）。
  出口仍是 `--update`（重记账、留一笔提交痕迹）。`tests/scripts-typecheck-ratchet.test.ts`
  补一条执行者：新增一份**干净**的入库脚本 ⇒ 红 ⇒ `--update` 之后才绿。

  同一次 CI 红里的另一条 `tests/affected-tests.test.ts`「真跑一遍」是**超时形态**
  （30s 上限，本地隔离复跑 3.2s 绿），按规范 §13.6.4 记作负载读数，**不抬预算、不改判据**。
