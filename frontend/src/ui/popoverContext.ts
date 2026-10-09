import { createContext, useContext } from 'react';

export const PopoverCloseContext = createContext<() => void>(() => {});

/** Inside a popover: a function that closes it (focus returns to the trigger). */
export function usePopoverClose(): () => void {
  return useContext(PopoverCloseContext);
}
