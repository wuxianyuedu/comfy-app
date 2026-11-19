## Fixed

- GA pr-gate.yml 5 个 job 均补上 if:failure() 的 actions/upload-artifact@v7 step，失败时自动上传 coverage/ 目录。artifact 名静态化（pr-gate-{job_name}）。