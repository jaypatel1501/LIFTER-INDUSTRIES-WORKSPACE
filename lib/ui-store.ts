import { create } from "zustand";

type DashboardUiState = {
  mobileNavigationOpen: boolean;
  toggleMobileNavigation: () => void;
  closeMobileNavigation: () => void;
};

export const useDashboardUiStore = create<DashboardUiState>((set) => ({
  mobileNavigationOpen: false,
  toggleMobileNavigation: () =>
    set((state) => ({ mobileNavigationOpen: !state.mobileNavigationOpen })),
  closeMobileNavigation: () => set({ mobileNavigationOpen: false }),
}));
