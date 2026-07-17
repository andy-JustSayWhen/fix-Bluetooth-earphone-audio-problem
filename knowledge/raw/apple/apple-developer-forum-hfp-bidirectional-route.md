<!-- 来源信息区：本区不是原文正文。 -->

- 来源机构或作者：Apple Developer Forums；答复者标记为 Apple Media Engineer
- 原始网址：https://developer.apple.com/forums/thread/829752
- 页面标题：BlietoothHFP to MFi hearingaids
- 发布或更新日期：June 2026；页面标注为 WWDC26 Audio Q&A
- 获取日期：2026-07-17
- 原文语言：English
- 清洗说明：下载页面的正文由动态脚本加载，静态文件未包含完整帖子。本文件仅保留检索接口成功取得的主题、问题范围和关键答复，没有用模型记忆补齐未取得的内容。
- 缺失范围：完整讨论串的全部逐字正文未能从下载文件中提取；如需引用上下文，应返回原始网址复核。
- 图片或附件：无。

---

# BlietoothHFP to MFi hearingaids

## Retrieved scope

The question asks whether a Bluetooth HFP microphone can be used as input while audio is sent to MFi hearing aids connected to an iPhone. The questioner reports that Bluetooth HFP takes both input and output, and gives up the input when output is moved to Bluetooth A2DP.

## Apple Media Engineer accepted answer — retained excerpt

> Since HFP is a bidirectional transport, it will always present as a input/output route.

The answer states that the requested HFP-input plus hearing-device-output route is not currently supported and asks the questioner to file a request through Apple Feedback Assistant.

## Scope note

The discussion concerns iPhone, Bluetooth HFP input and MFi hearing-aid output. It does not directly document the macOS cross-device behavior measured in this project.
