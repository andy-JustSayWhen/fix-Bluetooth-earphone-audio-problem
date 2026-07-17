#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static Boolean read_value(AudioObjectID object, AudioObjectPropertySelector selector,
                          AudioObjectPropertyScope scope, void *value, UInt32 size) {
    AudioObjectPropertyAddress address = { selector, scope, kAudioObjectPropertyElementMain };
    return AudioObjectGetPropertyData(object, &address, 0, NULL, &size, value) == noErr;
}

static void print_json_string(const char *text) {
    putchar('"');
    for (const unsigned char *cursor = (const unsigned char *)text; *cursor; cursor++) {
        switch (*cursor) {
            case '"': fputs("\\\"", stdout); break;
            case '\\': fputs("\\\\", stdout); break;
            case '\n': fputs("\\n", stdout); break;
            case '\r': fputs("\\r", stdout); break;
            case '\t': fputs("\\t", stdout); break;
            default:
                if (*cursor < 0x20) printf("\\u%04x", *cursor);
                else putchar(*cursor);
        }
    }
    putchar('"');
}

static char *copy_cf_string(CFStringRef value) {
    if (value == NULL) return strdup("");
    CFIndex length = CFStringGetLength(value);
    CFIndex maximum = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    char *result = calloc((size_t)maximum, 1);
    if (result == NULL || !CFStringGetCString(value, result, maximum, kCFStringEncodingUTF8)) {
        free(result);
        return strdup("");
    }
    return result;
}

static char *device_name(AudioObjectID device) {
    CFStringRef value = NULL;
    if (!read_value(device, kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal,
                    &value, sizeof(value))) return strdup("");
    char *result = copy_cf_string(value);
    if (value != NULL) CFRelease(value);
    return result;
}

int main(void) {
    AudioObjectPropertyAddress listAddress = {
        kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    UInt32 byteCount = 0;
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &listAddress, 0, NULL, &byteCount) != noErr) {
        fputs("[]\n", stdout);
        return 0;
    }
    AudioObjectID *processes = malloc(byteCount);
    if (processes == NULL || AudioObjectGetPropertyData(kAudioObjectSystemObject, &listAddress,
            0, NULL, &byteCount, processes) != noErr) {
        free(processes);
        fputs("[]\n", stdout);
        return 0;
    }

    Boolean first = true;
    putchar('[');
    for (UInt32 index = 0; index < byteCount / sizeof(AudioObjectID); index++) {
        AudioObjectID process = processes[index];
        UInt32 runningInput = 0;
        if (!read_value(process, kAudioProcessPropertyIsRunningInput,
                        kAudioObjectPropertyScopeGlobal, &runningInput, sizeof(runningInput)) || !runningInput) continue;

        pid_t pid = -1;
        read_value(process, kAudioProcessPropertyPID, kAudioObjectPropertyScopeGlobal, &pid, sizeof(pid));
        char processName[PROC_PIDPATHINFO_MAXSIZE] = {0};
        if (pid > 0) proc_name(pid, processName, sizeof(processName));

        CFStringRef bundleValue = NULL;
        read_value(process, kAudioProcessPropertyBundleID, kAudioObjectPropertyScopeGlobal,
                   &bundleValue, sizeof(bundleValue));
        char *bundleID = copy_cf_string(bundleValue);
        if (bundleValue != NULL) CFRelease(bundleValue);

        AudioObjectPropertyAddress devicesAddress = {
            kAudioProcessPropertyDevices,
            kAudioObjectPropertyScopeInput,
            kAudioObjectPropertyElementMain
        };
        UInt32 deviceBytes = 0;
        AudioObjectGetPropertyDataSize(process, &devicesAddress, 0, NULL, &deviceBytes);
        AudioObjectID *devices = deviceBytes > 0 ? malloc(deviceBytes) : NULL;
        if (devices != NULL && AudioObjectGetPropertyData(process, &devicesAddress, 0, NULL,
                                                          &deviceBytes, devices) != noErr) {
            free(devices);
            devices = NULL;
            deviceBytes = 0;
        }

        if (!first) putchar(',');
        first = false;
        printf("{\"pid\":%d,\"name\":", pid);
        print_json_string(processName[0] ? processName : "未知程序");
        fputs(",\"bundleId\":", stdout);
        print_json_string(bundleID);
        fputs(",\"devices\":[", stdout);
        for (UInt32 deviceIndex = 0; deviceIndex < deviceBytes / sizeof(AudioObjectID); deviceIndex++) {
            if (deviceIndex > 0) putchar(',');
            char *name = device_name(devices[deviceIndex]);
            print_json_string(name);
            free(name);
        }
        fputs("]}", stdout);
        free(bundleID);
        free(devices);
    }
    puts("]");
    free(processes);
    return 0;
}
