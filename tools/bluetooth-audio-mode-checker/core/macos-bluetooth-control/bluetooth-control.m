#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#include <unistd.h>

int IOBluetoothPreferenceGetControllerPowerState(void);
void IOBluetoothPreferenceSetControllerPowerState(int state);

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) return 2;
    NSString *operation = [NSString stringWithUTF8String:argv[1]];
    if ([operation isEqualToString:@"status"]) {
      printf("%d\n", IOBluetoothPreferenceGetControllerPowerState() ? 1 : 0);
      return 0;
    }
    if ([operation isEqualToString:@"power"] && argc == 3) {
      int requested = strcmp(argv[2], "1") == 0 ? 1 : strcmp(argv[2], "0") == 0 ? 0 : -1;
      if (requested < 0) return 2;
      if ((IOBluetoothPreferenceGetControllerPowerState() ? 1 : 0) == requested) return 0;
      IOBluetoothPreferenceSetControllerPowerState(requested);
      for (int attempt = 0; attempt <= 50; attempt += 1) {
        if (attempt > 0) usleep(100000);
        if ((IOBluetoothPreferenceGetControllerPowerState() ? 1 : 0) == requested) return 0;
      }
      fprintf(stderr, "Bluetooth power state did not change within 5 seconds\n");
      return 4;
    }
    return 2;
  }
}
