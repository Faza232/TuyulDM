import { create } from 'zustand';

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  onConfirm: () => void;
}

interface DialogsState {
  addUrlOpen: boolean;
  openAddUrl: () => void;
  closeAddUrl: () => void;

  confirm: ConfirmRequest | null;
  requestConfirm: (req: ConfirmRequest) => void;
  resolveConfirm: () => void;
  dismissConfirm: () => void;
}

export const useDialogs = create<DialogsState>((set, get) => ({
  addUrlOpen: false,
  openAddUrl: () => set({ addUrlOpen: true }),
  closeAddUrl: () => set({ addUrlOpen: false }),

  confirm: null,
  requestConfirm: (req) => set({ confirm: req }),
  resolveConfirm: () => {
    const c = get().confirm;
    if (c) c.onConfirm();
    set({ confirm: null });
  },
  dismissConfirm: () => set({ confirm: null }),
}));
