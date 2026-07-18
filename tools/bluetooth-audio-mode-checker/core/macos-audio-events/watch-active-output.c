#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <stdio.h>
#include <stdlib.h>

static AudioDeviceID current_output_device = kAudioObjectUnknown;
static AudioDeviceID current_input_device = kAudioObjectUnknown;

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

static AudioDeviceID read_default_input(void) {
    AudioDeviceID device = kAudioObjectUnknown;
    read_property(kAudioObjectSystemObject, kAudioHardwarePropertyDefaultInputDevice, &device, sizeof(device));
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
    AudioDeviceID output_device = read_default_output();
    AudioDeviceID input_device = read_default_input();
    CFStringRef output_name = NULL;
    CFStringRef input_name = NULL;
    Float64 nominal = 0;
    Float64 actual = 0;
    Float64 input_nominal = 0;
    Float64 input_actual = 0;
    UInt32 output_running = 0;
    UInt32 input_running = 0;
    if (output_device != kAudioObjectUnknown) {
        read_property(output_device, kAudioObjectPropertyName, &output_name, sizeof(output_name));
        read_property(output_device, kAudioDevicePropertyNominalSampleRate, &nominal, sizeof(nominal));
        read_property(output_device, kAudioDevicePropertyActualSampleRate, &actual, sizeof(actual));
        read_property(output_device, kAudioDevicePropertyDeviceIsRunning, &output_running, sizeof(output_running));
    }
    if (input_device != kAudioObjectUnknown) {
        read_property(input_device, kAudioObjectPropertyName, &input_name, sizeof(input_name));
        read_property(input_device, kAudioDevicePropertyNominalSampleRate, &input_nominal, sizeof(input_nominal));
        read_property(input_device, kAudioDevicePropertyActualSampleRate, &input_actual, sizeof(input_actual));
        read_property(input_device, kAudioDevicePropertyDeviceIsRunningSomewhere, &input_running, sizeof(input_running));
    }

    fputs("{\"name\":", stdout);
    print_json_string(output_name);
    fprintf(
        stdout,
        ",\"nominalSampleRate\":%.0f,\"actualSampleRate\":%.0f,\"isRunning\":%s,\"defaultInput\":{\"name\":",
        nominal,
        actual,
        output_running ? "true" : "false"
    );
    print_json_string(input_name);
    fprintf(
        stdout,
        ",\"isRunning\":%s,\"nominalSampleRate\":%.0f,\"actualSampleRate\":%.0f}}\n",
        input_running ? "true" : "false",
        input_nominal,
        input_actual
    );
    fflush(stdout);
    if (output_name != NULL) CFRelease(output_name);
    if (input_name != NULL) CFRelease(input_name);
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

static void remove_output_device_listeners(AudioDeviceID device) {
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

static void install_output_device_listeners(AudioDeviceID device) {
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

static void remove_input_device_listener(AudioDeviceID device) {
    if (device == kAudioObjectUnknown) return;
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyDeviceIsRunningSomewhere,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectRemovePropertyListener(device, &address, device_changed, NULL);
}

static void install_input_device_listener(AudioDeviceID device) {
    if (device == kAudioObjectUnknown) return;
    AudioObjectPropertyAddress address = {
        kAudioDevicePropertyDeviceIsRunningSomewhere,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    AudioObjectAddPropertyListener(device, &address, device_changed, NULL);
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
    if (next_device != current_output_device) {
        remove_output_device_listeners(current_output_device);
        current_output_device = next_device;
        install_output_device_listeners(current_output_device);
    }
    emit_snapshot();
    return noErr;
}

static OSStatus default_input_changed(
    AudioObjectID object,
    UInt32 count,
    const AudioObjectPropertyAddress addresses[],
    void *context
) {
    (void)object;
    (void)count;
    (void)addresses;
    (void)context;
    AudioDeviceID next_device = read_default_input();
    if (next_device != current_input_device) {
        remove_input_device_listener(current_input_device);
        current_input_device = next_device;
        install_input_device_listener(current_input_device);
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

static void poll_active_output(
    CFRunLoopTimerRef timer,
    void *context
) {
    (void)timer;
    (void)context;
    emit_snapshot();
}

int main(void) {
    current_output_device = read_default_output();
    current_input_device = read_default_input();
    install_output_device_listeners(current_output_device);
    install_input_device_listener(current_input_device);

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

    AudioObjectPropertyAddress input_address = {
        kAudioHardwarePropertyDefaultInputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    };
    if (AudioObjectAddPropertyListener(
        kAudioObjectSystemObject,
        &input_address,
        default_input_changed,
        NULL
    ) != noErr) {
        return 3;
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
        return 4;
    }

    CFRunLoopTimerContext timer_context = {0, NULL, NULL, NULL, NULL};
    CFRunLoopTimerRef timer = CFRunLoopTimerCreate(
        kCFAllocatorDefault,
        CFAbsoluteTimeGetCurrent() + 1.0,
        1.0,
        0,
        0,
        poll_active_output,
        &timer_context
    );
    if (timer == NULL) {
        return 5;
    }
    CFRunLoopAddTimer(CFRunLoopGetCurrent(), timer, kCFRunLoopCommonModes);
    CFRelease(timer);

    emit_snapshot();
    CFRunLoopRun();
    return 0;
}
