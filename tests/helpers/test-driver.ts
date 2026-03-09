import { AppCancelledError } from '../../src/ui/clack-driver.js';
import type { MenuOption, MenuResult, PromptDriver, PromptMessage, SelectOption } from '../../src/ui/driver.js';

export class TestPromptDriver implements PromptDriver {
  public readonly log: string[] = [];

  constructor(private readonly answers: Array<string | boolean>) {}

  intro(message: string): void {
    this.log.push(`intro:${message}`);
  }

  outro(message: string): void {
    this.log.push(`outro:${message}`);
  }

  note(message: string, title?: string): void {
    this.log.push(`note:${title ?? 'note'}:${message}`);
  }

  async select(message: PromptMessage, options: SelectOption[]): Promise<string> {
    this.log.push(`select:${message.message}`);
    const answer = this.shiftAnswer();
    if (answer === '__cancel__') {
      throw new AppCancelledError();
    }
    if (typeof answer !== 'string') {
      throw new Error(`Expected string answer for select: ${message.message}`);
    }
    if (!options.some((option) => option.value === answer)) {
      throw new Error(`Unexpected select answer ${answer} for ${message.message}`);
    }
    return answer;
  }

  async menu(message: PromptMessage, options: MenuOption[]): Promise<MenuResult> {
    this.log.push(`menu:${message.message}`);
    const answer = this.shiftAnswer();
    if (answer === '__cancel__') {
      throw new AppCancelledError();
    }
    if (typeof answer !== 'string') {
      throw new Error(`Expected string answer for menu: ${message.message}`);
    }
    if (answer === 'back') {
      this.log.push('back');
      return { action: 'back' };
    }
    if (answer.startsWith('space:')) {
      const value = answer.slice('space:'.length);
      const option = options.find((item) => item.value === value);
      if (!option) {
        throw new Error(`Unexpected space answer ${answer} for ${message.message}`);
      }
      this.log.push(`space:${value}`);
      return { action: 'space', value };
    }
    if (!options.some((option) => option.value === answer)) {
      throw new Error(`Unexpected menu answer ${answer} for ${message.message}`);
    }
    this.log.push(`enter:${answer}`);
    return { action: 'enter', value: answer };
  }

  async confirm(message: PromptMessage): Promise<boolean> {
    this.log.push(`confirm:${message.message}`);
    const answer = this.shiftAnswer();
    if (answer === '__cancel__') {
      throw new AppCancelledError();
    }
    if (typeof answer !== 'boolean') {
      throw new Error(`Expected boolean answer for confirm: ${message.message}`);
    }
    return answer;
  }

  async text(message: PromptMessage): Promise<string> {
    this.log.push(`text:${message.message}`);
    const answer = this.shiftAnswer();
    if (answer === '__cancel__') {
      throw new AppCancelledError();
    }
    if (typeof answer !== 'string') {
      throw new Error(`Expected string answer for text: ${message.message}`);
    }
    return answer;
  }

  async password(message: PromptMessage): Promise<string> {
    this.log.push(`password:${message.message}`);
    const answer = this.shiftAnswer();
    if (answer === '__cancel__') {
      throw new AppCancelledError();
    }
    if (typeof answer !== 'string') {
      throw new Error(`Expected string answer for password: ${message.message}`);
    }
    return answer;
  }

  private shiftAnswer(): string | boolean {
    const answer = this.answers.shift();
    if (answer === undefined) {
      throw new Error('No scripted answer left.');
    }
    return answer;
  }
}
