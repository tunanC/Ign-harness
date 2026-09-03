---
description: 读取 Server 端的文件内容
params:
  - name: path
    type: string
    required: true
    description: 文件的绝对路径或相对于 Server 工作目录的路径
  - name: encoding
    type: string
    required: false
    description: 文件编码，默认 utf-8
  - name: lines
    type: integer
    required: false
    description: 最多读取的行数，默认读取全部
---

# read_file

读取指定文件的内容并返回。

本工具短名：`read_file`

## 注意事项
- 超过 10000 字符会被截断
- 二进制文件会以十六进制预览方式返回
