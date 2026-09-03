---
description: 在用户 Windows 桌面设备上执行命令
params:
  - name: command
    type: string
    required: true
    description: 要执行的命令
  - name: cwd
    type: string
    required: false
    description: 工作目录（Windows 路径，如 E:\workspace\app；不填则用客户端启动目录；）
---

在用户 Windows 桌面设备上执行命令，返回 `{stdout, stderr, exit_code}`。

本工具短名：`bash`

## 执行约束
- 命令含重定向/管道时必须用 `wsl bash -c "..."` 包裹，否则被client端的shlex拆词后会出错
- 裸执行可执行文件（不是 shell）：不支持 cd/echo 等 shell 内建、多行脚本、`&&`/`;`/`>` 控制流
- 命令在Windows环境直接执行；Windows如有 Linux 子系统（如 WSL、gitbash等），需要用相应的方式访问
- 无状态：每条命令都是全新进程；cd/export/激活虚拟环境/别名等会话状态不跨命令保留——有状态的操作必须与使用者在同一条命令内完成
- 涉及路径一律用绝对路径且大小写敏感；目录敏感命令（git/npm/make 等）用 cwd 参数指定工作目录；cwd 表达不了的路径（如 Linux 子系统内的路径）在命令内切换目录后再执行
- 禁止吞错：不要用 `2>/dev/null`、`|| echo 兜底词`、`|| true`——错误必须出现在 stderr 中
- 后台服务（npm start 等）和交互程序（裸 python/node 等）会挂起或空转，不要直接运行
