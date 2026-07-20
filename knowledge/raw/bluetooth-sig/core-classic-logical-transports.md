<!-- 来源信息区：本区不是原文正文。 -->

- 来源机构或作者：Bluetooth SIG（蓝牙技术联盟）
- 规范版本：Bluetooth Core Specification 6.3（蓝牙核心规范 6.3）
- 原始网址：
  - https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/br-edr-controller/baseband-specification.html
  - https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/host/logical-link-control-and-adaptation-protocol-specification.html
  - https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core_v6.3/out/en/architecture%2C-change-history%2C-and-conventions/acronyms---abbreviations.html
- 获取日期：2026-07-17
- 补充核对日期：2026-07-20
- 原文语言：English（英文）
- 清洗说明：核心规范全文超过本项目当前问题的范围，本文件只保存本次实际核对的章节位置和少量关键原句；没有用模型记忆补齐未归档部分。
- 缺失范围：未本地复制两份规范页面的其余章节；完整上下文、图表、术语定义和后续勘误应以上述官方页面为准。

---

# Bluetooth Classic logical transports（传统蓝牙逻辑传输）

## Acronyms and Abbreviations（缩写与全称）

Bluetooth Core Specification 6.3（蓝牙核心规范 6.3）的缩写表给出：

> ACL — Asynchronous Connection-oriented [logical transport]

> SCO — Synchronous Connection-Oriented [logical transport]

> eSCO — Extended Synchronous Connection-Oriented [logical transport]

本文采用的技术直译分别是：

- ACL：异步面向连接逻辑传输。
- SCO：同步面向连接逻辑传输。
- eSCO：扩展同步面向连接逻辑传输。

这些术语及全称由 Bluetooth SIG（蓝牙技术联盟）定义。中文是本项目为便于理解采用的技术直译，不宣称是 Bluetooth SIG 发布的官方中文定名。旧资料有时把 ACL 展开为 `Asynchronous Connection-Less`，但本项目以当前核心规范的 `Connection-oriented` 为准。

## Baseband Specification（基带规范）

核对位置：第 4.3 节同步逻辑传输、第 4.4 节异步逻辑传输、第 7.6.3 节刷新负载。

与本项目结论直接相关的原句：

> SCO packets are never retransmitted.

> For most ACL packets, packet retransmission is applied to assure data integrity.

本节同时定义：SCO（同步面向连接传输）按固定间隔预留时隙；eSCO（扩展同步面向连接传输）在预留时隙后可以设置有限的重传窗口；eSCO 数据在窗口结束时自动丢弃。这里的中文说明用于定位原文含义，不替代规范原文。

## L2CAP Specification（逻辑链路控制与适配协议规范）

核对位置：服务质量与扩展流规范中关于流媒体访问延迟、刷新超时和接收端应用缓冲的段落。

与本项目结论直接相关的原句：

> For streaming traffic (such as in A2DP), the Access Latency should be set to indicate the time budgeted for transmission of the data over the air.

本节同时说明：流媒体的刷新超时需要考虑接收端应用缓冲，例如用于平滑到达时间波动的音视频缓冲。这里的中文说明用于定位原文含义，不替代规范原文。

## 原文边界说明

这些章节能证明传统蓝牙同步通话传输与普通异步数据传输在时隙、重传和超时规则上不同，也能证明 A2DP（蓝牙立体声播放模式）所在的流媒体路径可以把接收端应用缓冲纳入时间预算。它们不能单独证明某一副耳机使用了多大的缓冲、发生了多少次重传，或某一次无声一定由无线丢包造成。
