#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int output_channels(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyStreamConfiguration,
        kAudioObjectPropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || size == 0) return 0;
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
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &name) != noErr || name == NULL) return 0;
    char buffer[1024] = {0};
    Boolean converted = CFStringGetCString(name, buffer, sizeof(buffer), kCFStringEncodingUTF8);
    CFRelease(name);
    return converted && strcmp(buffer, target) == 0;
}

static AudioDeviceID find_output_device(const char *name) {
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr) return 0;
    AudioDeviceID *devices = malloc(size);
    if (devices == NULL) return 0;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, devices) != noErr) {
        free(devices);
        return 0;
    }
    UInt32 count = size / sizeof(AudioDeviceID);
    for (UInt32 index = 0; index < count; index++) {
        if (output_channels(devices[index]) > 0 && name_matches(devices[index], name)) {
            AudioDeviceID selected = devices[index];
            free(devices);
            return selected;
        }
    }
    free(devices);
    return 0;
}

static int read_scalar(AudioDeviceID device, AudioObjectPropertyElement element, Float32 *value) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyVolumeScalar,
        kAudioDevicePropertyScopeOutput,
        element
    };
    UInt32 size = sizeof(*value);
    return AudioObjectGetPropertyData(device, &address, 0, NULL, &size, value) == noErr;
}

static int set_scalar(AudioDeviceID device, AudioObjectPropertyElement element, Float32 value) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyVolumeScalar,
        kAudioDevicePropertyScopeOutput,
        element
    };
    Boolean settable = false;
    if (AudioObjectIsPropertySettable(device, &address, &settable) != noErr || !settable) return 0;
    return AudioObjectSetPropertyData(device, &address, 0, NULL, sizeof(value), &value) == noErr;
}

static int read_mute(AudioDeviceID device, UInt32 *muted) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyMute,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = sizeof(*muted);
    return AudioObjectGetPropertyData(device, &address, 0, NULL, &size, muted) == noErr;
}

static int set_mute(AudioDeviceID device, UInt32 muted) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyMute,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    };
    Boolean settable = false;
    if (AudioObjectIsPropertySettable(device, &address, &settable) != noErr || !settable) return 0;
    return AudioObjectSetPropertyData(device, &address, 0, NULL, sizeof(muted), &muted) == noErr;
}

static int print_volume(AudioDeviceID device) {
    Float32 master = 0;
    if (read_scalar(device, kAudioObjectPropertyElementMain, &master)) {
        UInt32 muted = 0;
        int has_mute = read_mute(device, &muted);
        printf("{\"volume\":%.2f,\"muted\":%s,\"source\":\"master\"}\n", master * 100.0f, has_mute && muted ? "true" : "false");
        return 0;
    }

    Float32 sum = 0;
    int count = 0;
    int channels = output_channels(device);
    for (int channel = 1; channel <= channels; channel++) {
        Float32 value = 0;
        if (read_scalar(device, (AudioObjectPropertyElement)channel, &value)) {
            sum += value;
            count++;
        }
    }
    if (count == 0) return 5;
    UInt32 muted = 0;
    int has_mute = read_mute(device, &muted);
    printf("{\"volume\":%.2f,\"muted\":%s,\"source\":\"channels\",\"channels\":%d}\n", (sum / count) * 100.0f, has_mute && muted ? "true" : "false", count);
    return 0;
}

static int write_volume(AudioDeviceID device, Float32 percent, int should_set_mute, UInt32 muted) {
    Float32 value = fmaxf(0.0f, fminf(100.0f, percent)) / 100.0f;
    int wrote = set_scalar(device, kAudioObjectPropertyElementMain, value);
    if (!wrote) {
        int channels = output_channels(device);
        for (int channel = 1; channel <= channels; channel++) {
            wrote = set_scalar(device, (AudioObjectPropertyElement)channel, value) || wrote;
        }
    }
    if (!wrote) return 6;
    if (should_set_mute) set_mute(device, muted);
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 3 || argc > 5 || (strcmp(argv[1], "read") != 0 && strcmp(argv[1], "write") != 0)) {
        fprintf(stderr, "usage: device-output-volume <read|write> <device-name> [volume] [muted]\n");
        return 2;
    }

    AudioDeviceID device = find_output_device(argv[2]);
    if (device == 0) {
        fprintf(stderr, "没有找到输出设备：%s\n", argv[2]);
        return 4;
    }

    if (strcmp(argv[1], "read") == 0) return print_volume(device);

    if (argc < 4) return 2;
    Float32 percent = strtof(argv[3], NULL);
    int should_set_mute = argc >= 5;
    UInt32 muted = should_set_mute && strcmp(argv[4], "true") == 0 ? 1 : 0;
    return write_volume(device, percent, should_set_mute, muted);
}
