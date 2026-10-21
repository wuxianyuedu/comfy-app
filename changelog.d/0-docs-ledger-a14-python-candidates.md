## Added

- **立 A14 一条账：`src/app/api/custom-nodes/route.ts` 绕开了「按平台选 Python 解释器」的唯一判据**。
  这条是上一轮「把 12 处解释器探测抽成一份内核」（口径 A）动手前的取证副产物 ——
  抽内核的过程要求先把「谁在自写候选表」数清楚，于是照出这个文件里**三处字面量**
  `["python3","python","py"]`，而 `pythonCandidates()` / `pythonProbeArgs()` 在它里面
  一次也没被 import（复算：`grep -c pythonCandidates src/app/api/custom-nodes/route.ts` → 0）。
  两条后果都落在 Windows（本应用的主要平台）上：**顺序错**（判据给 Windows 的是
  `["python","py","python3"]`，路由从 `python3` 起）与**起 `py` 不带 `-3`**
  （裸 `py` 的语义是列版本，不是跑脚本）。同一族的第二处旧形状也在：`streamParse` 的
  `close` 分支仍是 `code === 127 && i < pyCandidates.length - 1`，而 `#1665` 只在
  `runDiscoverStreaming` 那条链上把它改成了 `< pyCandidates.length`。
- **没有顺手改，并把「为什么不改」写进账里**：既有的 12 条流式协议执行者把**平台盲的顺序**
  当期望钉住（`route.test.ts` 的 `interpreterNames()` 逐条断 `toEqual(["python3","python","py"])`），
  所以这不是机械替换 —— 改吃判据等于同时改期望与真机行为，验收要按「注入 platform +
  两侧各做一次变异」来，且上面两条后果各自还需要正面用例（`py -3` 真的出现在 argv 里、
  Windows 上第一个候选是 `python`）。修法（共用一份「退避 + 按行切分 + 127/ENOENT 同因」内核，
  顺带合掉 §12.12 那对同族实现、盖住未覆盖的那 ~31 行）也一并写在条目里。
- 台账关系：这是 **E5 / §12.18 / 硬规则 24**「地基已有、调用点没复用」的一次现实复发 ——
  那份地基的文件头就写着「三处曾经各写一份候选名」，而第四处仍然在自己写。
