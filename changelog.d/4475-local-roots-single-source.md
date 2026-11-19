## Changed

- **本地工作流目录清单收成一处出处**（#4475）：`getAllowedLocalWorkflowRoots`
  直接复用 `getLocalWorkflowRoots`，不再在同文件里保留第二份逐字相同的实现——
  将来只改其中一份（比如再加目录来源）会重新造出「扫描看得到、导入守卫拒绝」
  的死胡同。
