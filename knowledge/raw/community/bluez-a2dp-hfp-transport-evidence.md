# BlueZ：A2DP 与 HFP 传输分别管理的实现证据

## 来源信息

- 项目：BlueZ
- 维护方：BlueZ 开源项目
- 源码仓库：https://github.com/bluez/bluez
- 更新记录：https://github.com/bluez/bluez/blob/master/ChangeLog
- 获取日期：2026-07-17
- 原文语言：英语
- 清洗说明：保留搜索取得的相关更新记录，不把 Linux 的接口直接描述成 macOS 可调用接口。

---

## 已取得的原文条目

> Fix issue with A2DP and handling of Transport.Acquire.

> Fix issue with A2DP transport connection collisions.

> Fix issue with A2DP cache invalidation handling.

> Fix issue with A2DP when SetConfiguration fails.

> Fix issue with Android HFP support and SCO/eSCO disconnection.

> Fix issue with SCO connection after codec negotiation.

> Fix issue with HSP/HFP reconnection policy.

## 来源所能证明的边界

- 该实现把 A2DP 的端点配置、传输获取与 HFP 的 SCO/eSCO 连接作为不同流程维护。
- 这是第三方开源协议栈的实现证据，可用于理解协议分层；不能据此声称 macOS 提供相同接口。
