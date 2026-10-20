import { useSyncExternalStore } from 'react';
import type { ControllerState, SessionController } from './sessionController';

/** React view of the controller: re-renders whenever its state changes. All logic lives in the controller. */
export function useSession(controller: SessionController): ControllerState {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}
