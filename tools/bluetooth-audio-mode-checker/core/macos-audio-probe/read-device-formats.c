#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>

static int read_channels(AudioDeviceID device, AudioObjectPropertyScope scope) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyStreamConfiguration,
        scope,
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

static CFStringRef read_name(AudioDeviceID device) {
    AudioObjectPropertyAddress address = {
        kAudioObjectPropertyName,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    CFStringRef name = NULL;
    UInt32 size = sizeof(name);
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &name) != noErr) return NULL;
    return name;
}

static double read_rate(AudioDeviceID device, AudioObjectPropertySelector selector) {
    AudioObjectPropertyAddress address = {
        selector,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    Float64 value = 0;
    UInt32 size = sizeof(value);
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &value) != noErr) return 0;
    return value;
}

static AudioValueRange *read_available_rates(AudioDeviceID device, UInt32 *count) {
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyAvailableNominalSampleRates,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    *count = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || size == 0) return NULL;
    AudioValueRange *ranges = malloc(size);
    if (ranges == NULL) return NULL;
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, ranges) != noErr) {
        free(ranges);
        return NULL;
    }
    *count = size / sizeof(AudioValueRange);
    return ranges;
}

static void print_json_string(CFStringRef value) {
    CFIndex length = CFStringGetLength(value);
    CFIndex maximum = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    char *buffer = malloc((size_t)maximum);
    if (buffer == NULL || !CFStringGetCString(value, buffer, maximum, kCFStringEncodingUTF8)) {
        free(buffer);
        fputs("\"\"", stdout);
        return;
    }
    putchar('"');
    for (char *cursor = buffer; *cursor != '\0'; cursor++) {
        unsigned char character = (unsigned char)*cursor;
        if (character == '"' || character == '\\') {
            putchar('\\');
            putchar(character);
        } else if (character == '\n') {
            fputs("\\n", stdout);
        } else if (character == '\r') {
            fputs("\\r", stdout);
        } else if (character == '\t') {
            fputs("\\t", stdout);
        } else if (character < 0x20) {
            printf("\\u%04x", character);
        } else {
            putchar(character);
        }
    }
    putchar('"');
    free(buffer);
}

int main(void) {
    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &address, 0, NULL, &size) != noErr) return 2;
    AudioDeviceID *devices = malloc(size);
    if (devices == NULL) return 2;
    if (AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, devices) != noErr) {
        free(devices);
        return 2;
    }

    UInt32 count = size / sizeof(AudioDeviceID);
    int first_device = 1;
    putchar('[');
    for (UInt32 index = 0; index < count; index++) {
        int input_channels = read_channels(devices[index], kAudioObjectPropertyScopeInput);
        int output_channels = read_channels(devices[index], kAudioObjectPropertyScopeOutput);
        if (input_channels == 0 && output_channels == 0) continue;
        CFStringRef name = read_name(devices[index]);
        if (name == NULL) continue;

        if (!first_device) putchar(',');
        first_device = 0;
        fputs("{\"name\":", stdout);
        print_json_string(name);
        printf(",\"inputChannels\":%d,\"outputChannels\":%d", input_channels, output_channels);
        printf(",\"nominalSampleRate\":%.6f", read_rate(devices[index], kAudioDevicePropertyNominalSampleRate));
        printf(",\"actualSampleRate\":%.6f", read_rate(devices[index], kAudioDevicePropertyActualSampleRate));
        fputs(",\"availableSampleRateRanges\":[", stdout);
        UInt32 range_count = 0;
        AudioValueRange *ranges = read_available_rates(devices[index], &range_count);
        for (UInt32 range_index = 0; range_index < range_count; range_index++) {
            if (range_index > 0) putchar(',');
            printf("{\"minimum\":%.6f,\"maximum\":%.6f}", ranges[range_index].mMinimum, ranges[range_index].mMaximum);
        }
        free(ranges);
        fputs("]}", stdout);
        CFRelease(name);
    }
    putchar(']');
    putchar('\n');
    free(devices);
    return 0;
}
