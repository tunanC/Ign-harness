---
description: 在 Server 端执行系统命令
params:
  - name: command
    type: string
    required: true
    description: 要执行的命令
---

# bash

在 Server 端执行系统命令，返回 `{stdout, stderr, exit_code}`。

本工具短名：`bash`
