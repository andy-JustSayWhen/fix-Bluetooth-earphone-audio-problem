#include <CoreAudio/CoreAudio.h>
#include <CoreFoundation/CoreFoundation.h>
#include <AudioToolbox/AudioHardwareService.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

static AudioDeviceID current_device = kAudioObjectUnknown;
static UInt32 current_channels = 0;

static AudioObjectPropertyAddress property_address(
    AudioObjectPropertySelector selector,
    AudioObjectPropertyScope scope,
    AudioObjectPropertyElement element
) {
    AudioObjectPropertyAddress address = {selector, scope, element};
    return address;
}

static bool read_property(
    AudioObjectID object,
    const AudioObjectPropertyAddress *address,
    void *value,
    UInt32 size
) {
    if (!AudioObjectHasProperty(object, address)) return false;
    return AudioObjectGetPropertyData(object, address, 0, NULL, &size, value) == noErr;
}

static AudioDeviceID read_default_output(void) {
    AudioDeviceID device = kAudioObjectUnknown;
    AudioObjectPropertyAddress address = property_address(
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    );
    read_property(kAudioObjectSystemObject, &address, &device, sizeof(device));
    return device;
}

static UInt32 read_output_channel_count(AudioDeviceID device) {
    AudioObjectPropertyAddress address = property_address(
        kAudioDevicePropertyStreamConfiguration,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    );
    UInt32 size = 0;
    if (AudioObjectGetPropertyDataSize(device, &address, 0, NULL, &size) != noErr || size == 0) return 0;
    AudioBufferList *buffers = calloc(1, size);
    if (buffers == NULL) return 0;
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, buffers) != noErr) {
        free(buffers);
        return 0;
    }
    UInt32 channels = 0;
    for (UInt32 index = 0; index < buffers->mNumberBuffers; index++) {
        channels += buffers->mBuffers[index].mNumberChannels;
    }
    free(buffers);
    return channels;
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

static void format_selector(AudioObjectPropertySelector selector, char output[5]) {
    output[0] = (char)((selector >> 24) & 0xff);
    output[1] = (char)((selector >> 16) & 0xff);
    output[2] = (char)((selector >> 8) & 0xff);
    output[3] = (char)(selector & 0xff);
    output[4] = '\0';
    for (int index = 0; index < 4; index++) {
        if (output[index] < 0x20 || output[index] > 0x7e) output[index] = '?';
    }
}

static void print_timestamp(void) {
    struct timeval now;
    struct tm utc;
    char date[32];
    gettimeofday(&now, NULL);
    gmtime_r(&now.tv_sec, &utc);
    strftime(date, sizeof(date), "%Y-%m-%dT%H:%M:%S", &utc);
    fprintf(stdout, "\"%s.%03dZ\"", date, (int)(now.tv_usec / 1000));
}

static void emit_snapshot(const char *event, const AudioObjectPropertyAddress *changed) {
    AudioDeviceID device = current_device;
    CFStringRef name = NULL;
    Float32 master_volume = 0;
    Float32 virtual_main_volume = 0;
    UInt32 muted = 0;
    Float64 nominal_rate = 0;
    Float64 actual_rate = 0;
    UInt32 running = 0;
    AudioObjectPropertyAddress name_address = property_address(
        kAudioObjectPropertyName,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    );
    AudioObjectPropertyAddress volume_address = property_address(
        kAudioDevicePropertyVolumeScalar,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    );
    AudioObjectPropertyAddress mute_address = property_address(
        kAudioDevicePropertyMute,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    );
    AudioObjectPropertyAddress virtual_volume_address = property_address(
        kAudioHardwareServiceDeviceProperty_VirtualMainVolume,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementMain
    );
    AudioObjectPropertyAddress nominal_address = property_address(
        kAudioDevicePropertyNominalSampleRate,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    );
    AudioObjectPropertyAddress actual_address = property_address(
        kAudioDevicePropertyActualSampleRate,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    );
    AudioObjectPropertyAddress running_address = property_address(
        kAudioDevicePropertyDeviceIsRunning,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    );

    bool has_name = device != kAudioObjectUnknown && read_property(device, &name_address, &name, sizeof(name));
    bool has_master = device != kAudioObjectUnknown && read_property(device, &volume_address, &master_volume, sizeof(master_volume));
    bool has_virtual_main = device != kAudioObjectUnknown
        && read_property(device, &virtual_volume_address, &virtual_main_volume, sizeof(virtual_main_volume));
    bool has_mute = device != kAudioObjectUnknown && read_property(device, &mute_address, &muted, sizeof(muted));
    bool has_nominal = device != kAudioObjectUnknown && read_property(device, &nominal_address, &nominal_rate, sizeof(nominal_rate));
    bool has_actual = device != kAudioObjectUnknown && read_property(device, &actual_address, &actual_rate, sizeof(actual_rate));
    bool has_running = device != kAudioObjectUnknown && read_property(device, &running_address, &running, sizeof(running));

    char selector[5] = "----";
    UInt32 element = 0;
    UInt32 scope = 0;
    if (changed != NULL) {
        format_selector(changed->mSelector, selector);
        element = changed->mElement;
        scope = changed->mScope;
    }

    fputs("{\"timestamp\":", stdout);
    print_timestamp();
    fprintf(stdout, ",\"event\":\"%s\",\"selector\":\"%s\",\"scope\":%u,\"element\":%u,\"deviceId\":%u,\"name\":", event, selector, scope, element, device);
    if (has_name) print_json_string(name); else fputs("null", stdout);
    if (has_master) fprintf(stdout, ",\"masterVolume\":%.4f", master_volume * 100.0f);
    else fputs(",\"masterVolume\":null", stdout);
    if (has_virtual_main) fprintf(stdout, ",\"virtualMainVolume\":%.4f", virtual_main_volume * 100.0f);
    else fputs(",\"virtualMainVolume\":null", stdout);
    if (has_mute) fprintf(stdout, ",\"muted\":%s", muted ? "true" : "false");
    else fputs(",\"muted\":null", stdout);
    fprintf(stdout, ",\"channelCount\":%u,\"channelVolumes\":[", current_channels);

    double sum = 0;
    UInt32 readable_channels = 0;
    for (UInt32 channel = 1; channel <= current_channels; channel++) {
        if (channel > 1) fputc(',', stdout);
        Float32 channel_volume = 0;
        AudioObjectPropertyAddress channel_address = property_address(
            kAudioDevicePropertyVolumeScalar,
            kAudioDevicePropertyScopeOutput,
            channel
        );
        if (read_property(device, &channel_address, &channel_volume, sizeof(channel_volume))) {
            fprintf(stdout, "%.4f", channel_volume * 100.0f);
            sum += channel_volume * 100.0f;
            readable_channels++;
        } else {
            fputs("null", stdout);
        }
    }
    if (readable_channels > 0) fprintf(stdout, "],\"averageChannelVolume\":%.4f", sum / readable_channels);
    else fputs("],\"averageChannelVolume\":null", stdout);
    if (has_nominal) fprintf(stdout, ",\"nominalSampleRate\":%.0f", nominal_rate);
    else fputs(",\"nominalSampleRate\":null", stdout);
    if (has_actual) fprintf(stdout, ",\"actualSampleRate\":%.0f", actual_rate);
    else fputs(",\"actualSampleRate\":null", stdout);
    if (has_running) fprintf(stdout, ",\"isRunning\":%s", running ? "true" : "false");
    else fputs(",\"isRunning\":null", stdout);
    fputs("}\n", stdout);
    fflush(stdout);
    if (name != NULL) CFRelease(name);
}

static OSStatus volume_changed(
    AudioObjectID object,
    UInt32 count,
    const AudioObjectPropertyAddress addresses[],
    void *context
) {
    (void)object;
    (void)context;
    for (UInt32 index = 0; index < count; index++) emit_snapshot("propertyChanged", &addresses[index]);
    return noErr;
}

static void update_device_listeners(AudioDeviceID device, bool install) {
    if (device == kAudioObjectUnknown) return;
    AudioObjectPropertyAddress address = property_address(
        kAudioObjectPropertySelectorWildcard,
        kAudioDevicePropertyScopeOutput,
        kAudioObjectPropertyElementWildcard
    );
    if (install) AudioObjectAddPropertyListener(device, &address, volume_changed, NULL);
    else AudioObjectRemovePropertyListener(device, &address, volume_changed, NULL);
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
    update_device_listeners(current_device, false);
    current_device = read_default_output();
    current_channels = read_output_channel_count(current_device);
    update_device_listeners(current_device, true);
    emit_snapshot("defaultOutputChanged", NULL);
    return noErr;
}

int main(void) {
    current_device = read_default_output();
    current_channels = read_output_channel_count(current_device);
    update_device_listeners(current_device, true);

    AudioObjectPropertyAddress default_address = property_address(
        kAudioHardwarePropertyDefaultOutputDevice,
        kAudioObjectPropertyScopeGlobal,
        kAudioObjectPropertyElementMain
    );
    if (AudioObjectAddPropertyListener(
        kAudioObjectSystemObject,
        &default_address,
        default_output_changed,
        NULL
    ) != noErr) {
        return 2;
    }

    emit_snapshot("initial", NULL);
    CFRunLoopRun();
    return 0;
}
