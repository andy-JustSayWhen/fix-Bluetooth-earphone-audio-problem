# Apple：macOS 蓝牙协议栈与公开接口边界

## 来源信息

- 发布机构：Apple
- 标题：Bluetooth Device Access Guide — Bluetooth on OS X
- 原始网址：https://developer.apple.com/library/archive/documentation/DeviceDrivers/Conceptual/Bluetooth/BT_Bluetooth_On_MOSX/BT_Bluetooth_On_MOSX.html
- 补充接口索引：https://developer.apple.com/documentation/iobluetooth
- 获取日期：2026-07-17
- 原文语言：英语
- 清洗说明：删除导航与页面装饰，保留本次研究相关段落；原文使用历史名称 OS X，本文不擅自改成其他版本名称。

---

## 已取得的原文

> Because Apple provides high-level managers and abstractions that transparently perform Bluetooth connection-oriented tasks for many types of applications, you may never need to use the API this chapter describes.

> Apple implements the L2CAP and RFCOMM layers in the kernel. Applications can use objects in the user-level L2CAP and RFCOMM layers to access the corresponding in-kernel objects, although many applications will not need to do so directly.

> In addition to the protocols shown in Figure 2-1, OS X implements several Bluetooth profiles. In general, a profile defines a particular usage of the protocols.

> The headset profile allows an application to use a Bluetooth enabled headset as the input or output audio device. After a headset is properly configured using the Bluetooth Setup Assistant application, an input and an output audio device associated with the headset are available for selection.

> With the methods and functions in the Bluetooth framework, you can:
>
> - Create and destroy connections to remote devices
> - Discover services on a remote device
> - Perform data transfers over various channels
> - Receive Bluetooth-specific status codes or messages

## 来源所能证明的边界

- Apple 公开描述了设备连接、服务发现和 L2CAP、RFCOMM 通道访问。
- 本次取得的 Apple 公开文档没有给出“强制当前系统音频从 HFP 切换为 A2DP”或“只释放系统正在管理的 HFP 音频连接”的公开调用方法。
- “没有在本次公开文档中找到”不等于证明私有实现内部不存在该能力。
