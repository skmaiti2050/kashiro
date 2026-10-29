import { readLocal, writeLocal } from './state/localMemory';

/** Whether the change log was open when the app last closed (F22 item 5): a per-PC convenience, not a setting. */
const STORAGE_KEY = 'kashiro.changeLogOpen';

/** True when the log was open last time; false when storage is off (it then starts closed, as before). */
export const changeLogWasOpen = (): boolean => readLocal(STORAGE_KEY) === 'true';

export const rememberChangeLogOpen = (open: boolean): void => writeLocal(STORAGE_KEY, String(open));
