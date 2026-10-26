## Fixed

**每日那一跑从此不再因为一格「平台形状当成通用前提」而恒红**（ISSUE #2403）。

`src/lib/process/probe-exe.test.ts` 里「被杀掉」那一格断言 `status: null`（POSIX 的形状），
而 Windows 上这个动作实测给的是 `status: 1` + `signal: null` —— win32 不产生信号退出码。
于是它在 Windows 节点上**确定性红**，且只有每日全量档走得到（PR 的增量档没选中它），
表现成「每天早上一跑红一次」。当场读数：本地 `vitest run <该文件>` ⇒ `1 failed | 19 passed`，
`AssertionError: expected { kind: 'nonzero-exit', …(2) } to match object { …, status: null }`；
同一条 spawn 的原值 ⇒ `status: 1 | signal: null | error: null`；平台侧 `cnb-42l-1k5q0ctkt`
的 `每日单元测试` 在 L791-792 就是这一格。复算前确认过：这两份文件在主干与我用例树逐字相同，
红在主干（随 `ade98a27` / #2338 进来）。

- 用例按平台分开钉，**两边都钉原值、谁也不放松**：win32 断
  `{kind:"nonzero-exit", status:1, signal:null}` 且话术给出 `exit 1` 并**不含「信号」**
  —— 拿不到信号就不许编一个出来（那是一条假归因）；POSIX 保持 `status:null` + `SIGKILL`。
- POSIX 那一支另加一格**注入式**话术断言（`describeProbeFailure({status:null,signal:"SIGKILL"})`
  含「被信号 SIGKILL 结束」）：本机是 win32，真 `spawn` 走不到那一支，不注入就等于那一半**没有执行者**。
- 实现文件里那句 `status 此时恒为 null` 一并订正成平台形状 —— 它就是这次误用的出处；
  留着的下一个人在 Windows 上还会照着写一遍（**注释也得说真话**）。
- `src/lib/**` 在 `prettier 格式` 的扫描面里：`--list-different` 两份文件都不出声；
  `eslint` 干净；`tsc --noEmit` 无输出；该文件 **21 passed**（本机 Windows）。
