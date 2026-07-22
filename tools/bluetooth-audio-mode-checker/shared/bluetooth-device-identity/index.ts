export function normalizeBluetoothAddress(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
}

export function isBluetoothTransport(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLocaleLowerCase().includes("bluetooth");
}

export function bluetoothPhysicalIdentity(
  address: string | null | undefined,
  name: string,
): string {
  const normalizedAddress = normalizeBluetoothAddress(address);
  return normalizedAddress
    ? `address:${normalizedAddress}`
    : `name:${name.trim().toLocaleLowerCase()}`;
}
