#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int read_channels(AudioDeviceID device, AudioObjectPropertyScope scope) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyStreamConfiguration,
        scope,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || size == 0) {
        return 0;
    }
    AudioBufferList *list = malloc(size);
    if (list == NULL) return 0;
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, list) != noErr) {
        free(list);
        return 0;
    }
    int channels = 0;
    for (UInt32 index = 0; index < list->mNumberBuffers; index++) {
        channels += (int)list->mBuffers[index].mNumberChannels;
    }
    free(list);
    return channels;
}

static int name_matches(AudioDeviceID device, const char *target) {
    AudioObjectPropertyAddress address = {
        kAudioObjectPropertyName,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    CFStringRef name = NULL;
    UInt32 size = sizeof(name);
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &name) != noErr || name == NULL) {
        return 0;
    }
    char buffer[1024] = {0};
    Boolean converted = CFStringGetCString(name, buffer, sizeof(buffer), kCFStringEncodingUTF8);
    CFRelease(name);
    return converted && strcmp(buffer, target) == 0;
}

int main(int argc, char **argv) {
    if (argc != 3 || (strcmp(argv[1], "input") != 0 && strcmp(argv[1], "output") != 0)) {
        fprintf(stderr, "usage: set-default-device <input|output> <device-name>\n");
        return 2;
    }

    int wants_input = strcmp(argv[1], "input") == 0;
    AudioObjectPropertyAddress devices_address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devices_address, 0, NULL, &size) != noErr) {
        fprintf(stderr, "无法读取声音设备列表\n");
        return 3;
    }
    AudioDeviceID *devices = malloc(size);
    if (devices == NULL) return 3;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &devices_address, 0, NULL, &size, devices) != noErr) {
        free(devices);
        fprintf(stderr, "无法读取声音设备列表\n");
        return 3;
    }

    AudioDeviceID selected = 0;
    UInt32 count = size / sizeof(AudioDeviceID);
    for (UInt32 index = 0; index < count; index++) {
        AudioObjectPropertyScope scope = wants_input
            ? kAudioObjectPropertyScopeInput
            : kAudioObjectPropertyScopeOutput;
        if (read_channels(devices[index], scope) > 0 && name_matches(devices[index], argv[2])) {
            selected = devices[index];
            break;
        }
    }
    free(devices);

    if (selected == 0) {
        fprintf(stderr, "没有找到支持所选方向的声音设备：%s\n", argv[2]);
        return 4;
    }

    AudioObjectPropertyAddress default_address = {
        wants_input
            ? kAudioHardwarePropertyDefaultInputDevice
            : kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    OSStatus status = AudioObjectSetPropertyData(
        kAudioObjectSystemObject,
        &default_address,
        0,
        NULL,
        sizeof(selected),
        &selected
    );
    if (status != noErr) {
        fprintf(stderr, "系统拒绝切换声音设备，状态码：%d\n", (int)status);
        return 5;
    }
    printf("ok\n");
    return 0;
}
