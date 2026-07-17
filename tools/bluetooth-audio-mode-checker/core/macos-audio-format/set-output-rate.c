#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
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
    for (UInt32 index = 0; index < list->mNumberBuffers; index++) channels += (int)list->mBuffers[index].mNumberChannels;
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

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    Float64 rate = strtod(argv[2], NULL);
    if (rate <= 16000) return 2;
    AudioObjectPropertyAddress devices_address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &devices_address, 0, NULL, &size) != noErr) return 3;
    AudioDeviceID *devices = malloc(size);
    if (devices == NULL) return 3;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &devices_address, 0, NULL, &size, devices) != noErr) {
        free(devices);
        return 3;
    }
    UInt32 count = size / sizeof(AudioDeviceID);
    for (UInt32 index = 0; index < count; index++) {
        AudioDeviceID device = devices[index];
        if (output_channels(device) <= 0 || !name_matches(device, argv[1])) continue;
        AudioObjectPropertyAddress rate_address = {
            kAudioDevicePropertyNominalSampleRate,
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        Boolean settable = false;
        if (AudioObjectIsPropertySettable(device, &rate_address, &settable) != noErr || !settable) {
            free(devices);
            return 4;
        }
        OSStatus result = AudioObjectSetPropertyData(device, &rate_address, 0, NULL, sizeof(rate), &rate);
        free(devices);
        return result == noErr ? 0 : 5;
    }
    free(devices);
    return 6;
}
