import { networkInterfaces } from 'node:os';
import type { NetworkAddress } from '@localmenti/shared';

export function lanAddresses(): NetworkAddress[] {
  return Object.entries(networkInterfaces()).flatMap(([label, addresses]) => (addresses ?? [])
    .filter(address => address.family === 'IPv4' && !address.internal)
    .map(address => ({ address: address.address, label })))
    .filter((value, index, array) => array.findIndex(other => other.address === value.address) === index);
}
