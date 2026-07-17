<!-- 来源信息区：本区不是原文正文。 -->

- 来源机构或作者：Apple Support
- 原始网址：https://support.apple.com/en-ae/guide/audio-midi-setup/ams6e21c3f61/mac
- 发布或更新日期：页面未标明；获取时适用于 macOS Tahoe 26，并可切换到 macOS Sequoia 15 等版本
- 获取日期：2026-07-17
- 原文语言：English
- 清洗说明：网页导航、版本选择器、页眉页脚、图片占位符和界面噪音已清除；正文、步骤、限制和相关链接保留。
- 图片或附件：正文示意图不承载本项目所引用的新事实，未单独归档。

---

# Combine audio devices into a single aggregate device in Audio MIDI Setup on Mac

You can combine several audio devices into a single device, called an aggregate device. For example, you can combine an eight-channel audio device and a two-channel audio device to work as a single ten-channel audio device.

Aggregating devices lets you increase the number of discrete audio inputs and outputs without having to purchase multichannel audio equipment. You can use an aggregate device for sound input or output, or for alerts and sound effects.

1. In the Audio MIDI Setup app on your Mac, click the Add button at the bottom of the sidebar in the Audio Devices window, then choose Create Aggregate Device.

   By default, the aggregate device is shown in a horizontal layout. To view it vertically, click the Set vertical layout button toward the upper-right corner of the window. To use the default layout again, click the Set horizontal layout button.

2. To rename the aggregate device, click it in the sidebar, then enter a new name.

3. In the right side of the window, do the following:

   - Select the devices to use: For each device you want to include in the aggregate device, select the Use checkbox.
   - Change settings for each device: Check that each device is set to the same sample rate, to ensure the aggregate device works correctly. You can also enable drift correction for each device. See [Set aggregate device settings](https://support.apple.com/en-ae/guide/audio-midi-setup/set-aggregate-device-settings-ams094c7edb4/3.6/mac/26).

If the Clock Source pop-up menu is available, you can use the clock of one device as the primary clock source for all the combined devices.

To remove an aggregate device, select it in the sidebar, then click the Remove button.

## See also

- [Set aggregate device settings in Audio MIDI Setup on Mac](https://support.apple.com/en-ae/guide/audio-midi-setup/set-aggregate-device-settings-ams094c7edb4/3.6/mac/26)
- [If an audio device isn’t working in Audio MIDI Setup on Mac](https://support.apple.com/en-ae/guide/audio-midi-setup/if-an-audio-device-isnt-working-amsa9337677e/3.6/mac/26)
- [If your audio apps stop working while using Audio MIDI Setup on Mac](https://support.apple.com/en-ae/guide/audio-midi-setup/if-your-audio-apps-stop-working-amsfa3961363/3.6/mac/26)
- [If audio switches to a different device in Audio MIDI Setup on Mac](https://support.apple.com/en-ae/guide/audio-midi-setup/if-audio-switches-to-a-different-device-ams0c519de39/3.6/mac/26)
