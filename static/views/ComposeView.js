import { Actions } from '../Actions.js';
import { Compose } from '../Compose.js';
import { IDBKeyVal } from '../idb-keyval.js';

const AUTO_SAVE_KEY = 'ComposeView-auto-save-key';
const SEND = { name: 'Send', description: 'Ummm...send the mail.' };
const ACTIONS = [ SEND ];
const PRE_FILL_URL = '/compose?to=email@address.com&subject=This is my subject&body=This is the email itself';
const HELP_TEXT = `Hints:

Put ## followed by a priority level in your email to automatically route your message to a that make-time priority. Valid priorities are ##must-do, ##urgent, ##not-urgent, ##delegate.

URL to prefill fields: <a href='${PRE_FILL_URL}'>${PRE_FILL_URL}</a>.
`;

export class ComposeView extends HTMLElement {
  constructor(contacts, updateTitle, params) {
    super();

    this.updateTitle_ = updateTitle;

    this.to_ = this.createInput_();
    this.appendLine_('To:\xa0', this.to_);

    this.subject_ = this.createInput_();
    this.appendLine_('Subject:\xa0', this.subject_);

    this.compose_ = new Compose(contacts, true);
    this.compose_.style.cssText = `
      flex: 1;
      margin: 4px;
      display: flex;
      background-color: white;
      min-height: 200px;
    `;

    this.prefill_(params);

    this.compose_.addEventListener('email-added', this.handleUpdates_.bind(this));
    this.compose_.addEventListener('input', this.debounceHandleUpdates_.bind(this));

    let help = document.createElement('div');
    help.style.cssText = `white-space: pre-wrap;`;
    help.innerHTML = HELP_TEXT;
    this.append(this.compose_, help);
  }

  async prefill_(queryParams) {
    let localData = await IDBKeyVal.getDefault().get(AUTO_SAVE_KEY);
    if (!localData)
      localData = queryParams;

    if (localData.to)
      this.to_.value = localData.to;
    if (localData.inlineTo)
      this.getInlineTo_().textContent = localData.inlineTo;
    if (localData.subject)
      this.subject_.value = localData.subject;
    if (localData.body)
      this.compose_.value = localData.body;

    this.focusFirstEmpty_();
  }

  createInput_() {
    let input = document.createElement('input');
    input.addEventListener('input', this.debounceHandleUpdates_.bind(this));
    input.style.cssText = `
      border: 1px solid;
      flex: 1;
      outline: none;
    `;
    return input;
  }

  appendLine_(...children) {
    let line = this.createLine_(...children);
    this.append(line);
  }

  createLine_(...children) {
    let line = document.createElement('div');
    line.style.cssText = `
      display: flex;
      margin: 4px;
    `;
    line.append(...children);
    return line;
  }

  inlineToText_() {
    if (!this.inlineTo_)
      return '';
    return this.inlineTo_.textContent;
  }

  getInlineTo_() {
    if (!this.inlineTo_) {
      this.inlineTo_ = document.createElement('div');
      let line = this.createLine_('Inline to:\xa0', this.inlineTo_);
      this.to_.parentNode.after(line);
    }
    return this.inlineTo_;
  }

  debounceHandleUpdates_() {
    requestIdleCallback(this.handleUpdates_.bind(this));
  }

  async handleUpdates_() {
    let emails = this.compose_.getEmails();
    if (emails.length)
      this.getInlineTo_().textContent = emails.join(', ');

    let data = {};
    let hasData = false;
    if (this.to_.value) {
      data.to = this.to_.value;
      hasData = true;
    }
    if (this.inlineTo_) {
      data.inlineTo = this.inlineToText_();
      hasData = true;
    }
    if (this.subject_.value) {
      data.subject = this.subject_.value;
      hasData = true;
    }
    if (this.compose_.value) {
      data.body = this.compose_.value;
      hasData = true;
    }

    if (hasData)
      await IDBKeyVal.getDefault().set(AUTO_SAVE_KEY, data);
    else
     await IDBKeyVal.getDefault().del(AUTO_SAVE_KEY);
  }

  focusFirstEmpty_() {
    if (!this.to_.value) {
      this.to_.focus();
      return;
    }

    if (!this.subject_.value) {
      this.subject_.focus();
      return;
    }

    this.compose_.focus();
  }

  connectedCallback() {
    let footer = document.getElementById('footer');
    footer.textContent = '';

    for (let action of ACTIONS) {
      let button = document.createElement('button');
      button.tooltip = action.description;

      button.onclick = () => this.takeAction_(action);
      button.onmouseenter = () => {
        button.tooltipElement = document.createElement('div');
        button.tooltipElement.style.cssText = `
          position: absolute;
          bottom: ${footer.offsetHeight}px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
        `;

        let text = document.createElement('div');
        text.style.cssText = `
          background-color: white;
          border: 1px solid;
          padding: 4px;
          width: 300px;
        `;

        text.append(button.tooltip);
        button.tooltipElement.append(text);
        footer.append(button.tooltipElement);
      }
      button.onmouseleave = () => {
        button.tooltipElement.remove();
      }
      let name = action.name;
      button.textContent = name;
      footer.append(button);
    }
  }

  async takeAction_(action) {
    if (action != SEND)
      throw `Invalid action: ${JSON.stringify(action)}`;

    if (this.sending_)
      return;
    this.sending_ = true;

    this.updateTitle_('sending', 'Sending...');
    let mail = await import('../Mail.js');

    let to = '';
    if (this.to_.value)
      to += this.to_.value + ',';
    if (this.inlineTo_)
      to += this.inlineToText_() + ',';

    await mail.send(this.compose_.value, to, this.subject_.value);
    await IDBKeyVal.getDefault().del(AUTO_SAVE_KEY);
    this.updateTitle_('sending');

    this.to_.value = '';
    if (this.inlineTo_)
      this.getInlineTo_().textContent = '';
    this.subject_.value = '';
    this.compose_.value = '';

    this.sending_ = false;
  }

  tearDown() {
  }
}

window.customElements.define('mt-compose-view', ComposeView);
