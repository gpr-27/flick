import { useEffect } from 'react';
import { create } from 'zustand';

interface ChromeState {
  /** How many open screens want the phone tab bar out of the way (e.g. a Settings section). */
  hideTabBar: number;
}

export const useChromeStore = create<ChromeState>(() => ({ hideTabBar: 0 }));

/** While `hide`, the phone bottom tab bar steps aside. */
export const useHideTabBar = (hide: boolean): void => {
  useEffect(() => {
    if (!hide) return;
    useChromeStore.setState((s) => ({ hideTabBar: s.hideTabBar + 1 }));
    return () => {
      useChromeStore.setState((s) => ({ hideTabBar: Math.max(0, s.hideTabBar - 1) }));
    };
  }, [hide]);
};
