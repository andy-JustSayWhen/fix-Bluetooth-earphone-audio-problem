<!-- 来源信息区：本区不是原文正文。 -->

- 来源机构或作者：C-Command Software，ToothFairy Manual
- 原始网址：https://c-command.com/toothfairy/help/improve-sound-quality-b
- 发布或更新日期：页面未标明
- 获取日期：2026-07-17
- 原文语言：English
- 清洗说明：手册导航和重复页眉页脚已清除；正文、例外、注释和产品限制保留。
- 图片或附件：无。

---

# 4.7 Improve sound quality by disabling audio input from device

Devices such as AirPods have both speakers and microphones; they can be used for both audio output and audio input. With many such devices, macOS will normally use the SCO or SBC Bluetooth audio codec because this works with both output and input. It is a good choice if you are making a VOIP call where you want to both listen and speak.

However, sometimes you may want to only listen, e.g. if you are playing music, watching a video, or playing a game. In this case, the SCO codec is not optimal because it has lower audio quality. A codec such AAC would provide better sounding audio, but it may not work with audio input. If you check the Improve sound quality by disabling audio input from device box, ToothFairy will tell macOS not to use the device’s microphone, which lets macOS use the higher quality codec that’s optimized for audio output.

It is still possible to do things that require audio input, e.g. starting a call or talking to Siri. Depending on the app, macOS will either use the Mac’s internal microphone (e.g. for Siri), use the microphone of another Bluetooth device for which you didn’t have this option selected, or use the Bluetooth device’s microphone (e.g. FaceTime), automatically switching it to the lower quality SCO codec (and overriding the change that ToothFairy made in System Settings). If this happens, when you’re done using the app, you can tell ToothFairy to disconnect and reconnect the device to switch it back to the high-quality AAC codec.

Note: Often, the audio quality can be improved by quitting the Xcode Simulator.

Note: You can download the Bluetooth Explorer app from Apple (as part of the “Additional Tools for Xcode 11”) to see and adjust codec settings for you devices.
