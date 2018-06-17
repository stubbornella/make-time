// Client ID and API key from the Developer Console
var CLIENT_ID = '749725088976-5n899es2a9o5p85epnamiqekvkesluo5.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
var DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
var SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets';

var USER_ID = 'me';

var authorizeButton = document.getElementById('authorize-button');

var base64 = new Base64();

// TODO: Get this out of a magic email.
const SPREADSHEET_ID = '1Z47Aovn53_o405wQG16wgKLaUwKnMmC6PmNnv0Wt0uI';

var g_state = {
  // Ordered list of threads.
  threads: [],
  // threadId --> thread map.
  threadMap: {},
  currentThreadIndex: 0,
};

// Make sure links open in new tabs.
document.body.addEventListener('click', (e) => {
  if (e.target.tagName == 'A') {
    e.target.target = '_blank';
    e.target.rel = 'noopener';
  }
});

window.onload = () => {
  gapi.load('client:auth2', () => {
    gapi.client.init({
      discoveryDocs: DISCOVERY_DOCS,
      clientId: CLIENT_ID,
      scope: SCOPES
    }).then(function () {
      // Listen for sign-in state changes.
      gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
      // Handle the initial sign-in state.
      updateSigninStatus(gapi.auth2.getAuthInstance().isSignedIn.get());
      authorizeButton.onclick = () => {
        gapi.auth2.getAuthInstance().signIn();
      };
    });
  });
};

async function fetchSheet(sheetName) {
  let response =  await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetName,
  });
  return response.result.values;
};

async function fetch2ColumnSheet(sheetName, opt_startRowIndex) {
  let result = {};
  let values = await fetchSheet(sheetName);
  if (!values)
    return result;

  let startRowIndex = opt_startRowIndex || 0;
  for (var i = startRowIndex; i < values.length; i++) {
    let value = values[i];
    result[value[0]] = value[1];
  }
  return result;
}

async function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.parentNode.style.display = 'none';
    setupResizeObservers();

    // TODO: Fetch these two in parallel.
    var settings = await fetch2ColumnSheet(CONFIG_SHEET_NAME, 1);
    settings.queuedLabelMap = await fetch2ColumnSheet(QUEUED_LABELS_SHEET_NAME, 1);

    let mailProcessor = new MailProcessor(settings);

    await updateThreadList(mailProcessor);
    await renderCurrentThread();

    // TODO: Move this to a cron, but for now at least do it after showing the first thread.
    guardedCall(mailProcessor.collapseStats.bind(mailProcessor));
  } else {
    authorizeButton.parentNode.style.display = '';
  }
}

function setupResizeObservers() {
  let ro = new ResizeObserver(entries => {
    for (let entry of entries) {
      let dummyElement = document.getElementById('dummy-' + entry.target.id);
      dummyElement.style.height = entry.contentRect.height + 'px';
    }
  });
  ro.observe(document.getElementById('header'));
  ro.observe(document.getElementById('footer'));
}

function updateCounter() {
  var index = g_state.currentThreadIndex;
  var threadsLeft = g_state.threads.length - index;
  var counter = document.getElementById('counter');
  var text = `${threadsLeft} threads left`
  if (threadsLeft)
    text += `&nbsp;&nbsp;|&nbsp;&nbsp;Currently triaging: ${removeTriagedPrefix(g_state.threads[index].queue)}`;
  counter.innerHTML = text;
}

function htmlEscape(html) {
  return html.replace(/[&<>"']/g, function(m) {
    switch (m) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case `'`:
        return '&#039;';
    }
  });
};

function toggleDisplayInline(element) {
  var current = getComputedStyle(element).display;
  element.style.display = current == 'none' ? 'inline' : 'none';
}

// Don't want stylesheets in emails to style the whole page.
function disableStyleSheets(messageText) {
  return messageText.replace(/<style/g, '<style type="not-css"');
}

function elideReply(messageText, previousMessageText) {
  let windowSize = 100;
  let minimumLength = 100;
  // Lazy hacks to get the element whose display to toggle
  // and to get this to render centered-ish elipsis without using an image.
  let prefix = `<div style="overflow:hidden"><div style="margin-top:-7px"><div class="toggler" onclick="toggleDisplayInline(this.parentNode.parentNode.nextSibling)">...</div></div></div><div class="elide">`;
  let postfix = `</div>`;

  let differ = new Differ(prefix, postfix, windowSize, minimumLength);
  return differ.diff(messageText, previousMessageText);
}

function renderMessage(processedMessage) {
  var messageDiv = document.createElement('div');
  messageDiv.className = 'message';

  messageDiv.classList.add(processedMessage.isUnread ? 'unread' : 'read');

  var headerDiv = document.createElement('div');
  headerDiv.classList.add('headers');
  headerDiv.textContent = `From: ${processedMessage.from}`;
  messageDiv.appendChild(headerDiv);

  var bodyContainer = document.createElement('div');
  bodyContainer.innerHTML = processedMessage.processedHtml;
  messageDiv.appendChild(bodyContainer);

  return messageDiv;
}

function renderNextThread() {
  g_state.currentThreadIndex = nextThreadIndex();
  renderCurrentThread();
}

function nextThreadIndex() {
  return Math.min(g_state.currentThreadIndex + 1, g_state.threads.length);
}

document.body.addEventListener('keydown', (e) => {
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    dispatchShortcut(e.key);
});

var keyToDestination = {
  'd': null, // No destination label for DONE
  't': READ_LATER_LABEL,
  'r': NEEDS_REPLY_LABEL,
  'b': BLOCKED_LABEL,
  'm': MUTED_LABEL,
  'a': ACTION_ITEM_LABEL,
}

function dispatchShortcut(key) {
  var destination = keyToDestination[key];
  if (destination !== undefined)
    markTriaged(g_state.currentThreadIndex, destination);
};

// TODO: make it so that labels created can have visibility of "hide" once we have a need for that.
function createLabel(labelName) {
  return new Promise(resolve => {
    var request = gapi.client.gmail.users.labels.create({
      userId: USER_ID,
      name: labelName,
      messageListVisibility: 'show',
      labelListVisibility: 'labelShow',
    });
    request.execute(resolve);
  });
}

async function getLabelId(labelName) {
  if (g_state.labelToId[labelName])
    return g_state.labelToId[labelName];

  await updateLabelList();
  var parts = labelName.split('/');

  // Create all the parent labels as well as the final label.
  var labelSoFar = '';
  for (var part of parts) {
    var prefix = labelSoFar ? '/' : '';
    labelSoFar += prefix + part;
    // creating a label 409's if the label already exists.
    // Technically we should handle the race if the label
    // gets created in between the start of the create call and this line. Meh.
    if (g_state.labelToId[labelSoFar])
      continue;

    var result = await createLabel(labelSoFar);
    var id = result.id;
    g_state.labelToId[labelSoFar] = id;
    g_state.idToLabel[id] = labelSoFar;
  }

  return g_state.labelToId[labelName];
}

async function modifyThread(thread, addLabelIds, removeLabelIds) {
  let resp = await gapi.client.gmail.users.threads.modify({
    'userId': USER_ID,
    'id': thread.id,
    'addLabelIds': addLabelIds,
    'removeLabelIds': removeLabelIds,
  });

  if (resp.status == '200') {
    // TODO: Show a spinner at the start so we can hide it here hide spinner
  } else {
    // retry? Show some error UI?
  }
}

async function markTriaged(threadIndex, destination) {
  var addLabelIds = [];
  if(destination)
    addLabelIds.push(await getLabelId(destination));

  var removeLabelIds = ['UNREAD', 'INBOX'];
  var triageQueue = g_state.threads[threadIndex].queue;
  if (triageQueue)
    removeLabelIds.push(await getLabelId(triageQueue));
  modifyThread(g_state.threads[threadIndex], addLabelIds, removeLabelIds);
  renderNextThread();
}

async function fetchMessages(index) {
  // This happens when we triage the last message.
  if (index == g_state.threads.length)
    return;

  var thread = g_state.threads[index];
  return await thread.fetchMessages();
}

function compareThreads(a, b) {
  return LabelUtils.compareLabels(a.queue, b.queue);
}

async function renderCurrentThread() {
  updateCounter();
  var content = document.getElementById('content');
  var subject = document.getElementById('subject');
  if (g_state.currentThreadIndex == g_state.threads.length) {
    content.textContent = 'All done triaging! \\o/ Reload to check for new threads.';
    subject.textContent = '';
    return;
  }
  content.textContent = '';

  // TODO: Inline this callback now that fetchMessagesForIndex is async.
  var callback = async (index) => {
    // If you cycle through threads quickly, then the callback for the previous
    // thread finishes before the current on has it's data.
    if (index != g_state.currentThreadIndex)
      return;

    let thread = g_state.threads[g_state.currentThreadIndex];

    subject.textContent = thread.subject;

    var lastMessageElement;
    for (var message of thread.messages) {
      lastMessageElement = renderMessage(message);
      content.append(lastMessageElement);
    }
    var elementToScrollTo = document.querySelector('.unread') || lastMessageElement;
    elementToScrollTo.scrollIntoView();
    // Make sure that there's at least 50px of space above for showing that there's a
    // previous message.
    let y = elementToScrollTo.getBoundingClientRect().y;
    if (y < 50)
      document.documentElement.scrollTop -= 50 - y;

    // Prefetch the next thread for instant access.
    fetchMessages(nextThreadIndex());
  }

  if (g_state.threads[g_state.currentThreadIndex].messages)
    callback(g_state.currentThreadIndex);
  else {
    let index = g_state.currentThreadIndex;
    await fetchMessages(index);
    callback(index);
  }
}

async function fetchThreads(label) {
  var query = 'in:' + label;

  // We only have triaged labels once they've actually been created.
  if (g_state.triagedLabels.length)
    query += ' -(in:' + g_state.triagedLabels.join(' OR in:') + ')';

  var getPageOfThreads = async function(opt_pageToken) {
    let requestParams = {
      'userId': USER_ID,
      'q': query,
    };

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    let resp = await gapi.client.gmail.users.threads.list(requestParams);
    let result = resp.result.threads || [];

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      result = result.concat(await getPageOfThreads(nextPageToken));
    return result;
  };

  return await getPageOfThreads();
}

async function fillLabelsForThreads(threads, outputArray, opt_outputMap) {
  let outputMap = opt_outputMap || {};
  var batch = gapi.client.newBatch();

  for (let i = 0; i < threads.length; i++) {
    let thread = threads[i];
    let threadWrapper = new Thread(thread);
    outputArray.push(threadWrapper);
    outputMap[thread.id] = threadWrapper;

    // Fetch the labels for each thread.
    batch.add(gapi.client.gmail.users.threads.get({
      'userId': USER_ID,
      'id': thread.id,
      'fields': 'id,messages/labelIds',
    }));
  }

  let resp = await batch;
  // For now just pretend that the labels on a thread are the union of the labels
  // on all it's messages.
  for (let index in resp.result) {
    let result = resp.result[index].result;
    let labelIds = new Set();
    for (let message of result.messages) {
      for (let labelId of message.labelIds) {
        labelIds.add(labelId);
      }
    }
    outputMap[result.id].addLabelIds(labelIds, g_state.idToLabel);
  }
}

async function guardedCall(func) {
  try {
    return await func();
  } catch (e) {
    var emailBody = 'Captured an error processing mail.' + e;

    if (e.body)
      emailBody += '\n' + e.body;

    if (e.name) {
      emailBody += '\n' + e.name;
      emailBody += '\nMessage: ' + e.message;
      emailBody += '\n\n' + e.stack;
    }

    // TODO: figure out how to send emails once this is back on a cron.
    alert(emailBody);
    throw e;
  }
};

async function updateThreadList(mailProcessor) {
  document.getElementById('loader').style.display = 'inline-block';
  await updateLabelList();

  // TODO: Move this to a cron
  await guardedCall(mailProcessor.processMail.bind(mailProcessor));
  await guardedCall(mailProcessor.processQueues.bind(mailProcessor));

  let threads = await fetchThreads('inbox');
  if (threads.length)
    await fillLabelsForThreads(threads, g_state.threads, g_state.threadMap);

  g_state.threads.sort(compareThreads);

  updateCounter();
  document.getElementById('loader').style.display = 'none';
}

async function updateLabelList() {
  var response = await gapi.client.gmail.users.labels.list({
    'userId': USER_ID
  })

  g_state.labelToId = {};
  g_state.idToLabel = {};
  g_state.triagedLabels = [];
  for (var label of response.result.labels) {
    g_state.labelToId[label.name] = label.id;
    g_state.idToLabel[label.id] = label.name;

    if (label.name.startsWith(TRIAGED_LABEL + '/'))
      g_state.triagedLabels.push(label.name);
  }
}
