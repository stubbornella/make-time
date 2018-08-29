class Vueue extends HTMLElement {
  constructor(threads, cleanupDelegate, updateTitleDelegate, allLabels) {
    super();
    this.style.display = 'block';

    this.threads_ = threads;
    this.cleanupDelegate_ = cleanupDelegate;
    this.updateTitle_ = updateTitleDelegate;
    this.allLabels_ = allLabels;
    this.groupByQueue_ = {};

    // I will never truly love javascript
    this.handleDone_ = this.handleDone_.bind(this);
  }

  // TODO: Really want an abstract base class for Vueue and ThreadView instead of
  // manually duplicating API surface.
  async dispatchShortcut(e) {}
  onHide() {}
  onShow() {}
  updateCurrentThread() {}

  finishedInitialLoad() {
    if (!this.initialThreadsView_.children.length) {
      this.triagedQueues_ = new TriagedQueues(this.allLabels_);
      this.append(this.triagedQueues_);
    }
  }

  async connectedCallback() {
    this.initialThreadsView_ = document.createElement('div');
    for (let thread of this.threads_) {
      await this.push(thread);
    }
    this.append(this.initialThreadsView_);

    let footer = document.createElement('div');
    footer.className = 'footer';

    let doneButton = document.createElement('button');
    doneButton.innerHTML = "Archive selected";
    doneButton.onclick = () => this.handleArchive_();
    footer.append(doneButton)

    let beginTriageButton = document.createElement('button');
    beginTriageButton.innerHTML = "Archive selected and begin triage";
    beginTriageButton.onclick = () => this.handleDone_();

    footer.append(beginTriageButton);

    this.append(footer);
  }

  getThreads_() {
    let selected = [];
    let unselected = [];
    for (let child of this.initialThreadsView_.querySelectorAll('mt-vueue-row')) {
      if (child.checked) {
        selected.push(child);
      } else {
        unselected.push(child.thread);
      }
    }
    return {
      selectedRows: selected,
      unselectedThreads: unselected,
    }
  }

  async handleDone_() {
    if (!navigator.onLine) {
      alert(`This action requires a network connection.`);
      return;
    }

    let threads = this.getThreads_();
    this.cleanupDelegate_(threads.unselectedThreads);
    await this.archiveThreads_(threads.selectedRows);
  }

  async handleArchive_() {
    if (!navigator.onLine) {
      alert(`This action requires a network connection.`);
      return;
    }

    let threads = this.getThreads_();
    await this.archiveThreads_(threads.selectedRows);
  }

  async removeRow_(row) {
    row.remove();
    let queue = await row.thread.getDisplayableQueue();
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup.hasRows()) {
      rowGroup.remove();
      delete this.groupByQueue_[queue];
    }
  }

  async archiveThreads_(rows) {
    this.updateTitle_('archiving', `Archiving ${rows.length} threads...`);

    // Update the UI first and then archive one at a time.
    for (let i = 0; i < rows.length; i++) {
      await this.removeRow_(rows[i]);
    }
    for (let i = 0; i < rows.length; i++) {
      this.updateTitle_('archiving', `Archiving ${i + 1}/${rows.length} threads...`);
      await rows[i].thread.markTriaged();
    }
    this.updateTitle_('archiving');
  }

  async push(thread) {
    if (this.triagedQueues_) {
      this.triagedQueues_.remove();
      this.triagedQueues_ = null;
    }

    let queue = await thread.getDisplayableQueue();
    let rowGroup = this.groupByQueue_[queue];
    if (!rowGroup) {
      rowGroup = new VueueRowGroup_(queue);
      this.groupByQueue_[queue] = rowGroup;
      this.initialThreadsView_.append(rowGroup);
    }
    rowGroup.push(thread);
  }
}
window.customElements.define('mt-vueue', Vueue);

class VueueRowGroup_ extends HTMLElement {
  constructor(queue) {
    super();
    this.style.display = 'block';

    this.queue_ = queue;

    let queueSpan = document.createElement('b')
    queueSpan.append(queue);

    let queueContainer = document.createElement('div');
    queueContainer.append(
      'Select ',
      this.createSelector_('all', this.selectAll_),
      this.createSelector_('none', this.selectNone_),
      `in `,
      queueSpan);

    queueContainer.style.marginRight = '6px';

    this.rowContainer_ = document.createElement('div');
    this.append(queueContainer, this.rowContainer_);
  }

  hasRows() {
    return !!this.rowContainer_.children.length;
  }

  push(thread) {
    this.rowContainer_.append(new VueueRow_(thread));
  }

  createSelector_(textContent, callback) {
    let selector = document.createElement('span');
    selector.textContent = textContent;
    selector.style.textDecoration = 'underline';
    selector.style.marginRight = '4px';
    selector.onclick = callback.bind(this);
    return selector;
  }

  selectAll_() {
    this.selectRows_(true);
  }

  selectNone_() {
    this.selectRows_(false);
  }

  selectRows_(value) {
    for (let child of this.rowContainer_.children) {
      child.checked = value;
    }
  }

  get queue() {
    return this.queue_;
  }
}
window.customElements.define('mt-vueue-row-group', VueueRowGroup_);

class VueueRow_ extends HTMLElement {
  constructor(thread) {
    super();
    this.style.display = 'block';

    this.thread_ = thread;

    this.thread_.getSubject()
    .then(subject => {
      this.thread_.getMessages()
      .then(messages => {
        let lastMessage = messages[messages.length - 1];

        let label = document.createElement('label');
        label.style.cssText = `
          display: flex;
        `;

        this.checkBox_ = document.createElement('input');
        this.checkBox_.type = 'checkbox';
        this.checkBox_.style.cssText = `
          margin-left: 5px;
          margin-right: 5px;
        `;
        this.checkBox_.onchange = this.updateHighlight_.bind(this);

        let fromContainer = document.createElement('div');
        fromContainer.style.cssText = `
          width: 150px;
          margin-right: 25px;
          display: flex;
          align-items: baseline;
        `;

        let from = document.createElement('div');
        from.style.cssText = `
          overflow: hidden;
        `;
        from.textContent = lastMessage.fromName;

        let count = document.createElement('div');
        count.style.cssText = `
          font-size: 80%;
          margin-left: 4px;
          color: grey;
        `;
        if (messages.length > 1)
          count.textContent = messages.length;

        fromContainer.append(from, count);

        let snippet = document.createElement('span');
        snippet.style.color = '#666';
        snippet.textContent = ` - ${this.thread_.snippet}`;

        let title = document.createElement('div');
        title.append(subject, snippet);
        title.style.cssText = `
          overflow: hidden;
          margin-right: 25px;
          flex: 1;
        `;

        let date = document.createElement('div');
        date.textContent = this.dateString_(lastMessage.date);

        label.append(this.checkBox_, fromContainer, title, date);

        this.append(label);
      });
    });
  }

  updateHighlight_() {
    this.style.backgroundColor = this.checkBox_.checked ? '#c2dbff' : '';
  }

  dateString_(date) {
    let options = {};
    let today = new Date();
    if (today.getYear() != date.getYear())
      options.year = 'numeric';

    if (today.getMonth() != date.getMonth() || today.getDate() != date.getDate()) {
      options.month = 'short';
      options.day = 'numeric';
    } else {
      options.hour = 'numeric';
      options.minute = 'numeric';
    }

    return date.toLocaleString(undefined, options);
  }

  get checked() {
    // If we're mid construction of the row, then the checkbox may not exist yet.
    return this.checkBox_ && this.checkBox_.checked;
  }

  set checked(value) {
    this.checkBox_.checked = value;
    this.updateHighlight_();
  }

  get thread() {
    return this.thread_;
  }
}
window.customElements.define('mt-vueue-row', VueueRow_);