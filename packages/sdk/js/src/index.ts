// @x-computer/sdk — JavaScript/TypeScript SDK for X-Computer
export { XComputerClient, createClient } from './client.js';
export type { XComputerClientOptions } from './client.js';

// Re-export everything from @x-computer/core so consumers only need one import
export type * from '@x-computer/core';
export * from '@x-computer/core';
