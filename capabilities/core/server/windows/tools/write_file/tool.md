---
description: 在 Server 端写入文件
params:
  - name: path
    type: string
    required: true
    description: 文件路径
  - name: content
    type: string
    required: true
    description: 要写入的内容
  - name: encoding
    type: string
    required: false
    description: 文件编码，默认 utf-8
  - name: mode
    type: string
    required: false
    description: 写入模式。write（覆盖）或 append（追加），默认 write
---

# write_file

将内容写入 Server 上的文件。

本工具短名：`write_file`

## 注意事项
- 如果父目录不存在会自动创建
- 默认使用覆盖写入模式
