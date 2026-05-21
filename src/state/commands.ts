import { create } from 'zustand';
import type { CommandItem } from '../ui/primitives/CommandPalette';

interface CommandsState {
  commands: CommandItem[];
  registerCommand: (cmd: CommandItem) => () => void;
  registerCommands: (cmds: CommandItem[]) => () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
}

export const useCommands = create<CommandsState>((set) => ({
  commands: [],
  open: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  registerCommand: (cmd) => {
    set((state) => {
      // prevent exact duplicates by id
      if (state.commands.some(c => c.id === cmd.id)) return state;
      return { commands: [...state.commands, cmd] };
    });
    return () => set((state) => ({ commands: state.commands.filter((c) => c.id !== cmd.id) }));
  },
  registerCommands: (cmds) => {
    set((state) => {
      const news = cmds.filter(cmd => !state.commands.some(c => c.id === cmd.id));
      if (news.length === 0) return state;
      return { commands: [...state.commands, ...news] };
    });
    return () => set((state) => ({ commands: state.commands.filter((c) => !cmds.some(cmd => cmd.id === c.id)) }));
  }
}));
