#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int read_channels(AudioDeviceID device) {
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

static double max_output_rate(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyAvailableNominalSampleRates,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || size == 0) return 0;
    AudioValueRange *ranges = malloc(size);
    if (ranges == NULL) return 0;
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, ranges) != noErr) {
        free(ranges);
        return 0;
    }
    double maximum = 0;
    UInt32 count = size / sizeof(AudioValueRange);
    for (UInt32 index = 0; index < count; index++) {
        if (ranges[index].mMaximum > maximum) maximum = ranges[index].mMaximum;
    }
    free(ranges);
    return maximum;
}

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr) return 3;
    AudioDeviceID *devices = malloc(size);
    if (devices == NULL) return 3;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, devices) != noErr) {
        free(devices);
        return 3;
    }
    UInt32 count = size / sizeof(AudioDeviceID);
    for (UInt32 index = 0; index < count; index++) {
        if (read_channels(devices[index]) > 0 && name_matches(devices[index], argv[1])) {
            double maximum = max_output_rate(devices[index]);
            free(devices);
            if (maximum <= 0) return 4;
            printf("%.0f\n", maximum);
            return 0;
        }
    }
    free(devices);
    return 4;
}
