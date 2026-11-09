// CI-RED-CANARY：本文件是临时探针，仅用于验证远端 PR 流水线（质量门禁 / *gates）在坏代码下
// 能否正确变红。文件故意包含一个类型错误，但没有任何真实代码依赖它。验证结束后整文件删除即可还原。
function ciRedCanaryTriggerTypecheckFailure(): void {
  // 故意的类型错误：把字符串字面量赋给声明为 number 的变量，tsc --noEmit 会因此报 TS2322。
  const intentionalTypeError: number = "ci-red-canary-intentional-type-error";
  // 引用一次以避免 oxlint 报 unused；不影响上面的类型错误。
  if (intentionalTypeError > 0) {
    throw new Error(String(intentionalTypeError));
  }
}
ciRedCanaryTriggerTypecheckFailure();
