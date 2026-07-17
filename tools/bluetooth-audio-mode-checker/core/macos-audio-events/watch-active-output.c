#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>

static AudioDeviceID current_device = kAudioObjectUnknown;

static int read_property(AudioObjectID object, AudioObjectPropertySelector selector, void *value, UInt32 size) {
    AudioObjectPropertyAddress address = {
        selector,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    return AudioObjectGetPropertyData(object, &address, 0, NULL, &size, value) == noErr;
}

static AudioDeviceID read_default_output(void) {
    AudioDeviceID device = kAudioObjectUnknown;
    read_property(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultOutputDevice, &device, sizeof(device));
    return device;
}

static void print_json_string(CFStringRef value) {
    if (value == NULL) {
        fputs("null", stdout);
        return;
    }
    CFIndex length = CFStringGetLength(value);
    CFIndex maximum = CFStringGetMaximumSizeForEncoding(length, kCFStringEncodingUTF8) + 1;
    char *buffer = calloc((size_t)maximum, 1);
    if (buffer == NULL || !CFStringGetCString(value, buffer, maximum, kCFStringEncodingUTF8)) {
        free(buffer);
        fputs("null", stdout);
        return;
    }
    fputc('"', stdout);
    for (char *cursor = buffer; *cursor != '\0'; cursor++) {
        unsigned char character = (unsigned char)*cursor;
        if (character == '"' || character == '\\') {
            fputc('\\', stdout);
            fputc(character, stdout);
        } else if (character == '\n') {
            fputs("\\n", stdout);
        } else if (character == '\r') {
            fputs("\\r", stdout);
        } else if (character == '\t') {
            fputs("\\t", stdout);
        } else if (character >= 0x20) {
            fputc(character, stdout);
        }
    }
    fputc('"', stdout);
    free(buffer);
}

static void emit_snapshot(void) {
    AudioDeviceID device = read_default_output();
    if (device == kAudioObjectUnknown) {
        fputs("{\"name\":null,\"nominalSampleRate\":null,\"actualSampleRate\":null,\"isRunning\":false}\n", stdout);
        fflush(stdout);
        return;
    }

    CFStringRef name = NULL;
    Float64 nominal = 0;
    Float64 actual = 0;
    UInt32 running = 0;
    read_property(device, kAudioObjectPropertyName, &name, sizeof(name));
    read_property(device, kAudioDevicePropertyNominalSampleRate, &nominal, sizeof(nominal));
    read_property(device, kAudioDevicePropertyActualSampleRate, &actual, sizeof(actual));
    read_property(device, kAudioDevicePropertyDeviceIsRunning, &running, sizeof(running));

    fputs("{\"name\":", stdout);
    print_json_string(name);
    fprintf(
        stdout,
        ",\"nominalSampleRate\":%.0f,\"actualSampleRate\":%.0f,\"isRunning\":%s}\n",
        nominal,
        actual,
        running ? "true" : "false"
    );
    fflush(stdout);
    if (name != NULL) CFRelease(name);
}

static OSStatus device_changed(
    AudioObjectID object,
    UInt32 count,
    const AudioObjectPropertyAddress addresses[],
    void *context
) {
    (void)object;
    (void)count;
    (void)addresses;
    (void)context;
    emit_snapshot();
    return noErr;
}

static void remove_device_listeners(AudioDeviceID device) {
    if (device == kAudioObjectUnknown) return;
    AudioObjectPropertySelector selectors[] = {
        kAudioDevicePropertyNominalSampleRate,
        kAudioDevicePropertyActualSampleRate,
        kAudioDevicePropertyDeviceIsRunning
    };
    for (size_t index = 0; index < sizeof(selectors) / sizeof(selectors[0]); index++) {
        AudioObjectPropertyAddress address = {
            selectors[index],
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectRemovePropertyListener(device, &address, device_changed, NULL);
    }
}

static void install_device_listeners(AudioDeviceID device) {
    if (device == kAudioObjectUnknown) return;
    AudioObjectPropertySelector selectors[] = {
        kAudioDevicePropertyNominalSampleRate,
        kAudioDevicePropertyActualSampleRate,
        kAudioDevicePropertyDeviceIsRunning
    };
    for (size_t index = 0; index < sizeof(selectors) / sizeof(selectors[0]); index++) {
        AudioObjectPropertyAddress address = {
            selectors[index],
            kAudioObjectPropertyScopeGlobal,
            kAudioObjectPropertyElementMain
        };
        AudioObjectAddPropertyListener(device, &address, device_changed, NULL);
    }
}

static OSStatus default_output_changed(
    AudioObjectID object,
    UInt32 count,
    const AudioObjectPropertyAddress addresses[],
    void *context
) {
    (void)object;
    (void)count;
    (void)addresses;
    (void)context;
    AudioDeviceID next_device = read_default_output();
    if (next_device != current_device) {
        remove_device_listeners(current_device);
        current_device = next_device;
        install_device_listeners(current_device);
    }
    emit_snapshot();
    return noErr;
}

static OSStatus device_list_changed(
    AudioObjectID object,
    UInt32 count,
    const AudioObjectPropertyAddress addresses[],
    void *context
) {
    (void)object;
    (void)count;
    (void)addresses;
    (void)context;
    emit_snapshot();
    return noErr;
}

int main(void) {
    current_device = read_default_output();
    install_device_listeners(current_device);

    AudioObjectPropertyAddress address = {
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectAddPropertyListener(
        kAudioObjectSystemObject,
        &address,
        default_output_changed,
        NULL
    ) != noErr) {
        return 2;
    }

    AudioObjectPropertyAddress devices_address = {
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectAddPropertyListener(
        kAudioObjectSystemObject,
        &devices_address,
        device_list_changed,
        NULL
    ) != noErr) {
        return 3;
    }

    emit_snapshot();
    CFRunLoopRun();
    return 0;
}
