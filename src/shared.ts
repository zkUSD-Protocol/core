import { MinaNetworkInterface } from './mina/network-interface';

export async function initLightnet(): Promise<MinaNetworkInterface> {
  return await MinaNetworkInterface.initLightnet();
}

export function sharedFunction(message: string): string {
  return `Shared says: ${message}`;
}
