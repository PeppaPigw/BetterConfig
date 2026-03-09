export interface PromptMessage {
  message: string;
  placeholder?: string;
  initialValue?: string;
}

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

export interface MenuOption {
  value: string;
  label: string;
  icon?: string;
  hint?: string;
  kind?: 'default' | 'toggle';
  checked?: boolean;
}

export interface MenuResult {
  action: 'enter' | 'space' | 'back';
  value?: string;
  /** Index of the item that was acted on, so callers can restore the cursor. */
  cursor?: number;
}

export interface PromptDriver {
  intro(message: string): void | Promise<void>;
  outro(message: string): void | Promise<void>;
  note(message: string, title?: string): void | Promise<void>;
  select(message: PromptMessage, options: SelectOption[]): Promise<string>;
  menu(message: PromptMessage, options: MenuOption[]): Promise<MenuResult>;
  confirm(message: PromptMessage): Promise<boolean>;
  text(message: PromptMessage): Promise<string>;
  password(message: PromptMessage): Promise<string>;
}
