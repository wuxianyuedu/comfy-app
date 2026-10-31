#!/usr/bin/env node
/**
 * ship-local.mjs —— `pnpm ship` 的**本地两段**：工作树读数、commit、push（规范 §13.6）。
 *
 * 从 `ship.mjs` 分出来的理由不是行数好看（那是 `check-infra-file-size.cjs` 的 900 硬闸
 * 在 #2189 现场报出来的：加上「只补关」那一格之后它是 928 行，本文件当时 885 行），
 * 而是**变化方向不同**：
 *   · `ship-core.mjs` 判的是外部执行者的形状（平台 build / PR / git 输出 → 三态结论）；
 *   · `ship-platform.mjs` 是平台侧三段（PR / verdict / 合并并回读）+ 分支清理，
 *     轮询那一格在 `ship-poll.mjs`；
 *   · 本文件是**只动本地 ref 与远端同名分支**的那两段 —— 它们不碰 cnb，也不需要平台回读。
 * 装配、阶段顺序与那一份「各段结论」的记账（`codes` + `finish()`）仍留在 `ship.mjs`，
 * 因为「谁跑了、各段结论是什么」这件事只能有一处（#2156 那本账防的就是它长第二处）。
 *
 * 判据一个字不搬：该不该提交、提交信息能不能原样进历史、push 前那份合并前证明读没读到，
 * 全在 `ship-core.mjs` 那一份纯判断里；这里只做「按注入的 `run` 发命令 + 把原话念出来」。
 * 两段的返回形状是 `{stop, codes}`：`codes` 是要并入装配层那本账的结论（**可能两条**，
 * 比如「没读到证明 ⇒ NOT_RUN」之后 push 那一格自己仍记 GREEN），`stop` 才表示
 * 「这条链到此为止」—— 与搬动之前逐字同口径，包括顺序。
 */

/**
 * 一次 `run` 的最小形状（与 `ship.mjs` 注入的那份同源，不在此重新定义判据）。
 * @typedef {(cmd: string, args: string[], opts?: {env?: Record<string,string>}) => {status: number, stdout: string, stderr?: string, error?: string | null}} PlatformRun
 */

import { CODE, classifyPushFailure, looksNewlineMangled, readProof } from "./ship-core.mjs";
import { safeRead, short } from "./ship-exec.mjs";
/* 「这一笔是刻意的空提交」不靠猜索引 —— 由被触发的两条 D0 判据认这个说出来的旗标
 * （唯一生产者就是下面这一格，口径在 `intentional-empty-commit.mjs`，ISSUE #2354）。 */
import { EMPTY_COMMIT_ENV } from "./intentional-empty-commit.mjs";

/**
 * 把 `git status --porcelain` 的输出**按列**分成「已暂存 / 未暂存（已修改）/ 未跟踪」三档。
 *
 * ⚠️ 必须按列取状态位，**绝不能先 `trim()`**：porcelain 每行是 `XY <路径>`，前两字符
 * `X`=索引状态、`Y`=工作树状态。先 `trim()` 会把行首空格吃掉，于是未暂存的 ` M file`
 * 塌成 `M file` 被误判成已暂存（ISSUE #2073）—— 那一句读数谎报，还会让
 * 「还有未暂存的改动」提醒永不触发。
 *
 * @param {string} stdout `git status --porcelain` 的原始输出
 * @returns {{staged: string[], unstagedModified: string[], untracked: string[]}}
 */
export function parsePorcelain(stdout) {
  /** @type {string[]} */
  const staged = [];
  /** @type {string[]} */
  const unstagedModified = [];
  /** @type {string[]} */
  const untracked = [];
  for (const raw of String(stdout).split("\n")) {
    if (!raw) {
      continue;
    }
    const x = raw[0]; // 索引状态
    const y = raw[1]; // 工作树状态
    if (x === "?") {
      untracked.push(raw.slice(3)); // `?? <path>`
      continue;
    }
    // X 是索引里的真实状态（非空格、非未跟踪、非忽略）⇒ 已暂存。
    if (x !== " " && x !== "!") {
      staged.push(raw.slice(3));
    }
    // Y 是工作树里的真实改动（非空格、非忽略）⇒ 未暂存（已修改）。
    if (y !== " " && y !== "!") {
      unstagedModified.push(raw.slice(3));
    }
  }
  return { staged, unstagedModified, untracked };
}

/**
 * 阶段 1：把点名的路径暂存下来并提交 —— **不代写提交信息，也不 `git add -A`**。
 *
 * @param {{
 *   opt: {message: string | null, messageFile: string | null, adds: string[]},
 *   root: string,
 *   staged: string[],
 *   unstagedModified: string[],
 *   untracked: string[],
 *   log: (s: string) => void,
 *   run: PlatformRun,
 *   relay: (r: {stdout: string, stderr?: string}) => void,
 * }} ctx
 * @returns {{stop: boolean, codes: number[]}}
 */
export function runCommitStage(ctx) {
  const { opt, root, staged, unstagedModified, untracked, log, run, relay } = ctx;
  const msg = opt.messageFile ? safeRead(root, opt.messageFile) : opt.message;
  if (staged.length + unstagedModified.length + untracked.length > 0) {
    if (!msg) {
      log("[ship] 有改动但没给 --message ⇒ 停。提交信息是判断（症状/读数/因果），脚本不代写。");
      return { stop: true, codes: [CODE.RED] };
    }
    /* 排在 `git add` **之前**：既然这条信息不能原样进历史，就不要先把暂存面改了
     * 再退回去 —— 那一手会让「这次提交包含什么」被一次不会发生的提交动过。 */
    if (looksNewlineMangled(msg)) {
      log("[ship] `--message` 里没有真换行、却带着字面量 \\n ⇒ 这条信息已被 `pnpm run` 压成一行。");
      log(
        "[ship] 按原样提交只会得到一整行 subject，而 PR 标题取的就是它（实测那样一份被平台拒）。",
      );
      log(
        "[ship] 两条出口：`pnpm ship --message-file <路径>`（多行信息的正路），" +
          '或 `pnpm exec node scripts/ship.mjs --message "…"`（`pnpm exec` 保留真换行）。',
      );
      return { stop: true, codes: [CODE.RED] };
    }
    for (const a of opt.adds) {
      run("git", ["add", "--", a]);
    }
    /* 提交信息走 argv 直传，**不落文件**：`spawnSync` 这一跳不经 shell，git 拿到的
     * 就是数组里那一串字面量（引号、多行都不再被解释），没有 `-F` 那一套「写个临时
     * 文件、提交完还得删干净」的泄漏面（AGENTS 硬规则 12 把 `COMMIT_EDITMSG` 落进
     * 工作区点名为「提交完忘了删」的信号 —— 少建一个文件，就少一处会忘的地方）。
     * ⚠️ 「多行不会被破坏」只保证**这一跳**：更外层的 `pnpm run` 已经把 argv 里的
     * 真换行改写成字面量 `\n` 了，那一格由上面 `looksNewlineMangled` 拦下。 */
    const cm = run("git", ["commit", `--message=${msg}`]);
    relay(cm);
    if (cm.status !== 0) {
      log(
        `[ship] 提交被门槛拦下（exit ${cm.status}）。钩子的原话在上面，**不要**用 --no-verify 换一条干净历史。`,
      );
      return { stop: true, codes: [CODE.RED] };
    }
    log("[ship] ✓ 已提交（门槛全过）");
  } else {
    log("[ship] 工作树干净 ⇒ 跳过提交这一段。");
  }
  return { stop: false, codes: [CODE.GREEN] };
}

/**
 * 阶段 2：推这一条分支 —— 合并前的固定动作由 `pre-push` 钩子自己跑，这里只**读**它落的那份证明。
 *
 * 「没读到证明」与「证明里说主干本来就红」是两件事：前者是这一格没有结论（NOT_RUN），
 * 后者已经由钩子放行并写明（§13.6.2）。所以两种话术分开，不合并成一句「push 完成」。
 *
 * @param {{
 *   up: {remote: string | null},
 *   branch: string,
 *   root: string,
 *   resolveDir: (cwd?: string) => string | null,
 *   log: (s: string) => void,
 *   run: PlatformRun,
 *   relay: (r: {stdout: string, stderr?: string}) => void,
 * }} ctx
 * @returns {{stop: boolean, codes: number[]}}
 */
export function runPushStage(ctx) {
  const { up, branch, root, resolveDir, log, run, relay } = ctx;
  if (!up.remote) {
    log(
      "[ship] 推不出远端名（既没有上游、也不是「唯一远端」）⇒ push 没有执行者，" +
        "这一格不是「通过」（三态退出码：这是 NOT_RUN）。",
    );
    return { stop: true, codes: [CODE.NOT_RUN] };
  }
  const ps = run("git", ["push", "-u", up.remote, branch]);
  relay(ps);
  if (ps.status !== 0) {
    /* 分型按 push 原话（ISSUE #2825）：远端 128 与钩子拒绝的修法完全不同，不再固定猜 premerge。 */
    log(`[ship] push 失败（exit ${ps.status}）⇒ ${classifyPushFailure(ps.stdout, ps.stderr).note}`);
    return { stop: true, codes: [CODE.RED] };
  }
  const codes = [];
  /* 证明的读取也走这一次注入的解析器 —— 少了这个参数，注入只覆盖临时文件那一半，
   * 而这一格会去读这台机器真实的 `.git`（用例本地绿、节点红就是这么来的）。 */
  const proof = readProof(root, resolveDir);
  if (proof) {
    log(
      `[ship] ✓ 合并前证明：head ${short(proof.headSha)} · 上游 ${short(proof.upstreamSha)} · ${proof.verifiedAt || "?"}`,
    );
    if (Array.isArray(proof.baselineRed) && proof.baselineRed.length > 0) {
      log(`[ship]   其中 ${proof.baselineRed.length} 条是主干自带的红（已放行，见 §13.6.2）`);
    }
  } else {
    log("[ship] 没读到合并前证明（HEAD 与上游都没动，或钩子未接上）⇒ 这一格**没有**结论。");
    codes.push(CODE.NOT_RUN);
  }
  codes.push(CODE.GREEN);
  return { stop: false, codes };
}

/**
 * 阶段：CI 失败重试 —— 在当前分支推一个空提交以触发平台重新构建（规范 §13.6）。
 *
 * 平台侧 CI 是 push 触发的：没有「重跑按钮」时，唯一能重新派生一条流水线的方式就是
 * 再推一次。空提交不动任何文件，只为了让 push 事件再次发生、派生一条新 build。
 * 这与「撞了红线想重跑」的诉求一一对应，且**不需要去 cnbcli 翻有没有重跑入口**。
 *
 * 与 `runCommitStage` 不同：它**强制** `--allow-empty`，即使工作树干净也照推不误
 * （普通提交段在干净时会「跳过提交」）。判定只在两处停：推不出远端、或在 master 上。
 * 这一格是写动作（commit + push），但只读 cnb、不创建 PR、不轮询 —— 由 `ship.mjs`
 * 排在 `--diagnose` 之后、preflight 之前直接返回，与 `--merge` 那一路互斥。
 * 返回的是三态结论（与 `--diagnose` 那一路同口径）：由 `ship.mjs` 直接 `finish([...])`。
 *
 * @param {{up:{remote:string|null}, branch:string, root:string, log:(s:string)=>void, run:PlatformRun, relay:(r:{stdout:string,stderr?:string})=>void, opt:{dryRun:boolean}}} ctx
 * @returns {number} 三态结论（GREEN / RED / NOT_RUN）
 */
export function runRerunCiStage(ctx) {
  const { up, branch, log, run, relay, opt } = ctx;
  if (!up.remote) {
    log(
      "[ship] 推不出远端名（既没有上游、也不是「唯一远端」）⇒ 没有 push 执行者，" +
        "rerun 没法触发新 build（这一格不是「通过」：NOT_RUN）。",
    );
    return CODE.NOT_RUN;
  }
  if (branch === "master" || branch === "HEAD") {
    log(
      `[ship] 当前在 ${branch} 上 ⇒ rerun 要在「有 PR 的分支」上跑，跳过（退 2 提醒：换到 PR 分支再试）。`,
    );
    return CODE.NOT_RUN;
  }
  const msg = "ci: rerun (ship --rerun-ci)";
  const env = { [EMPTY_COMMIT_ENV]: "1" };
  if (opt.dryRun) {
    log("[ship] [dry-run] 将执行：");
    log(`[ship]   ${EMPTY_COMMIT_ENV}=1 git commit --allow-empty --message="${msg}"`);
    log(`[ship]   git push -u ${up.remote} ${branch}`);
    log(
      `[ship]   （带这个旗标是因为 D0 里有两步读当场暂存区：空索引本来是「取不到判决面」，` +
        "而这一笔的空是**说出来的**空 —— 它不改任何文件，那两条的问题没有对象。）",
    );
    return CODE.GREEN;
  }
  const cm = run("git", ["commit", "--allow-empty", `--message=${msg}`], { env });
  relay(cm);
  if (cm.status !== 0) {
    log(`[ship] 空提交失败（exit ${cm.status}）。`);
    return CODE.RED;
  }
  const ps = run("git", ["push", "-u", up.remote, branch]);
  relay(ps);
  if (ps.status !== 0) {
    /* 同上（ISSUE #2825）：rerun 那一跳也不固定猜 premerge，按原话分型。 */
    log(`[ship] push 失败（exit ${ps.status}）⇒ ${classifyPushFailure(ps.stdout, ps.stderr).note}`);
    return CODE.RED;
  }
  const sha = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  log(`[ship] ✓ 已在 ${branch} 推一个空提交（${short(sha)}）触发新 build`);
  /* 意图这句**由发起方说**：钩子在成功时只汇成一行「入选档位全部通过」，判据自己那句
   * 只有单独跑它、或它判红时才看得见 —— 所以「谁改的口径」这件事写在这里，不留在注释里。 */
  log(
    `[ship]   那一跳带 ${EMPTY_COMMIT_ENV}=1：D0 里读暂存区的两步按「空提交没有可判的对象」收` +
      "（口径 scripts/intentional-empty-commit.mjs，规范 §13.5.5 末段）。",
  );
  log("[ship]   稍后用 pnpm ship --diagnose 看这一跑的结果。");
  return CODE.GREEN;
}
