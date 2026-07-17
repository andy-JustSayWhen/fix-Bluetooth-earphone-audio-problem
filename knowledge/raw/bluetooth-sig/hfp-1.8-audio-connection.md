# Bluetooth SIG：Hands-Free Profile 1.8 音频连接

## 来源信息

- 发布机构：Bluetooth SIG
- 规范：Hands-Free Profile 1.8
- 原始网址：https://www.bluetooth.com/specifications/specs/hands-free-profile-1-8/
- 规范附件：https://www.bluetooth.org/DocMan/handlers/DownloadDoc.ashx?doc_id=489628
- 测试规范：https://files.bluetooth.com/wp-content/uploads/dlm_uploads/2025/02/HFP.TS_.p28.pdf
- 获取日期：2026-07-17
- 原文语言：英语
- 清洗说明：本地仅保留本次研究实际取得、直接关系到音频链路建立与释放的原文内容；规范附件正文未能由当前网页读取器完整展开，未用模型记忆补齐。

---

## 已取得的原文

> The Hands-Free Profile (HFP) specification defines a set of functions such that a Mobile Phone can be used in conjunction with a Hands-Free device [...] with a Bluetooth Link providing a wireless means for both remote control of the Mobile Phone by the Hands-Free device and voice connections between the Mobile Phone and the Hands-Free device.

测试规范取得的相关原文：

> The IUT requests an eSCO full duplex Audio Connection with the Lower Tester.

> The Lower Tester negotiates and establishes an Audio Connection with the IUT over eSCO.

> Full duplex audio is available between the IUT and the Lower Tester using eSCO.

> Audio Connection Release

> Verify that both the HF and the AG can remove an existing Audio Connection between them.

> Verify that the HF can remove an existing Audio Connection with the AG, whenever necessary and even out of a call process.

## 取得范围限制

- 上述测试原文明确区分音频连接的建立与释放。
- 本地没有取得 HFP 1.8 主规范的完整正文，因此不在本文件补写未读取到的章节、命令或状态机细节。
