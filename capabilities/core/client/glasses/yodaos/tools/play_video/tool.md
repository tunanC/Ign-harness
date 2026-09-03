---
description: 在用户眼镜（Rokid AR 眼镜，YodaOS）上播放视频
params:
  - name: src
    type: string
    required: true
    description: 视频地址（URL 或本地路径）
---

在用户 Rokid AR 眼镜上播放视频，画面显示在眼镜 HUD 的悬浮视频窗中。

本工具短名：`play_video`

## 执行约束
- src 是必填参数——视频地址；用户没有给出明确地址时，先在其他设备上搜索/确认，不要编造地址
- 调用即开始播放并返回结果，不等待播放完成
- 结果返回 `{ok, src, status}`：status 为 "playing"（开始播放）或 "error"（无法播放）
