export const shortcutDefaults: Record<string, string>;
export const shortcutGroups: Array<[string, Array<[string, string]>]>;
export const customCommands: Set<string>;
export function resolveShortcut(command: string, custom?: Record<string, string>): string | undefined;
export function validateShortcuts(custom: Record<string, string>, mac: boolean): Record<string, string>;
export function displayShortcut(accelerator?: string, mac?: boolean): string;
