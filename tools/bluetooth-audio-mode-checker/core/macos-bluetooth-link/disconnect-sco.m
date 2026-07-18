#import <Foundation/Foundation.h>
#import <IOBluetooth/IOBluetooth.h>
#import <IOBluetooth/objc/IOBluetoothHandsFreeAudioGateway.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *targetName = [NSString stringWithUTF8String:argv[1]];
    IOBluetoothDevice *target = nil;
    for (IOBluetoothDevice *device in [IOBluetoothDevice pairedDevices]) {
      if ([[device name] isEqualToString:targetName]) {
        target = device;
        break;
      }
    }
    if (target == nil) return 3;
    if (![target isConnected]) return 4;

    IOBluetoothHandsFreeAudioGateway *gateway =
      [[IOBluetoothHandsFreeAudioGateway alloc] initWithDevice:target delegate:nil];
    if (gateway == nil) return 5;

    BOOL wasConnected = [gateway isSCOConnected];
    [gateway disconnectSCO];
    for (NSInteger attempt = 0; attempt < 50 && [gateway isSCOConnected]; attempt += 1) {
      [NSThread sleepForTimeInterval:0.1];
    }
    printf("{\"scoWasConnected\":%s,\"scoConnected\":%s}\n",
           wasConnected ? "true" : "false",
           [gateway isSCOConnected] ? "true" : "false");
    return [gateway isSCOConnected] ? 6 : 0;
  }
}
