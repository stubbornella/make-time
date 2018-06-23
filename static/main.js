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

async function updateCounter() {
  let counter = document.getElementById('counter');
  if (!g_state.threads || g_state.threads instanceof Vueue) {
    counter.textContent = '';
    return;
  }

  if (!g_state.currentThread)
    renderNextThread();

  // Include the current thread in the count of threads left.
  var threadsLeft = g_state.currentThread ? g_state.threads.length + 1 : 0;
  var text = `${threadsLeft} threads left`
  if (g_state.currentThread) {
    let queue = await g_state.currentThread.getDisplayableQueue();
    text += `&nbsp;&nbsp;|&nbsp;&nbsp;Currently triaging: ${queue}`;
  }
  counter.innerHTML = text;
}

var g_state = {};

let settings_;

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

window.addEventListener('error', (e) => {
  console.log(e.stack);

  var emailBody = 'Captured an error: ' + e.message;
  if (e.body)
    emailBody += '\n' + e.body;
  if (e.stack)
    emailBody += '\n\n' + e.stack;

  // TODO: figure out how to send emails once this is back on a cron.
  alert(emailBody);
});

window.addEventListener('unhandledrejection', (e) => {
  alert(`Unhandled rejection ${e.reason.stack}`);
});

function getSettingsSpreadsheetId() {
  if (localStorage.spreadsheetId)
    return localStorage.spreadsheetId;
  let url = prompt("Insert the URL of your settings spreadsheet. If you don't have one, go to go/make-time-settings, create a copy of it, and then use the URL of the new spreadsheet.");
  // Spreadsheets URLS are of the form
  // https://docs.google.com/spreadsheets[POSSIBLE_STUFF_HERE]/d/[ID_HERE]/[POSSIBLE_STUFF_HERE]
  let id = url.split('/d/')[1].split('/')[0];
  localStorage.spreadsheetId = id;
  return id;
}

async function fetchSheet(spreadsheetId, sheetName) {
  let response =  await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: spreadsheetId,
    range: sheetName,
  });
  return response.result.values;
};

async function fetch2ColumnSheet(spreadsheetId, sheetName, opt_startRowIndex) {
  let result = {};
  let values = await fetchSheet(spreadsheetId, sheetName);
  if (!values)
    return result;

  let startRowIndex = opt_startRowIndex || 0;
  for (var i = startRowIndex; i < values.length; i++) {
    let value = values[i];
    result[value[0]] = value[1];
  }
  return result;
}

async function getSettings() {
  if (!settings_) {
    let spreadsheetId = getSettingsSpreadsheetId();
    document.getElementById('settings').href = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    // TODO: Fetch these two in parallel.
    settings_ = await fetch2ColumnSheet(spreadsheetId, CONFIG_SHEET_NAME, 1);
    settings_.spreadsheetId = spreadsheetId;
    settings_.queuedLabelMap = await fetch2ColumnSheet(spreadsheetId, QUEUED_LABELS_SHEET_NAME, 1);
  }
  return settings_;
}

function resetThreadList() {
  g_state.threads = new ThreadList(updateCounter);
  g_state.currentThread = null;
}

async function viewThreadAtATime(threadsToDone, threadsToTriage) {
  if (threadsToDone.length) {
    showLoader(true);
    updateTitle(`Archiving ${threadsToDone.length} threads...`);
  }

  resetThreadList();
  for (let thread of threadsToTriage) {
    await g_state.threads.push(thread);
  }

  if (!g_state.currentThread)
    renderAllDone();

  document.getElementById('thread-at-a-time-footer').style.visibility = '';

  for (let thread of threadsToDone) {
    await markTriaged(thread)
  }

  showLoader(false);
}

async function viewAll(e) {
  e.preventDefault();

  if (g_state.threads instanceof Vueue)
    return;

  if (!g_state.currentThread)
    return;

  let threads = g_state.threads;
  // Null this out so that pushing the current thread doesn't update the counter.
  g_state.threads = null;
  await threads.push(g_state.currentThread);

  g_state.threads = new Vueue(threads, viewThreadAtATime);

  await updateCounter();
  getSubjectContainer().textContent = '';

  var content = getContentContainer();
  content.textContent = '';
  content.append(g_state.threads);

  // Don't display none, since this is the thing that keeps space for the toolbar at the bottom.
  // TODO: Make this less brittle as we move the thread-at-a-time view code into it's own element.
  document.getElementById('thread-at-a-time-footer').style.visibility = 'hidden';
}

async function updateSigninStatus(isSignedIn) {
  if (isSignedIn) {
    authorizeButton.parentNode.style.display = 'none';
    document.getElementById('view-all').onclick = viewAll;
    setupResizeObservers();
    await updateThreadList();
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
  ro.observe(document.getElementById('thread-at-a-time-footer'));
}

function updateTitle(title) {
  document.getElementById('title').textContent = title;
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

document.body.addEventListener('keydown', async (e) => {
  if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    await dispatchShortcut(e.key);
});

var keyToDestination = {
  'd': null, // No destination label for DONE
  't': READ_LATER_LABEL,
  'r': NEEDS_REPLY_LABEL,
  'm': MUTED_LABEL,
  'a': ACTION_ITEM_LABEL,
}

async function dispatchShortcut(key) {
  if (!g_state.currentThread)
    return;

  if (!keyToDestination.b)
    keyToDestination.b = addQueuedPrefix(await getSettings(), BLOCKED_LABEL_SUFFIX);

  var destination = keyToDestination[key];
  if (destination !== undefined) {
    markTriaged(g_state.currentThread, destination);
    await renderNextThread();
  }
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

async function markTriaged(thread, destination) {
  var addLabelIds = [];
  if (destination)
    addLabelIds.push(await getLabelId(destination));

  var removeLabelIds = ['UNREAD', 'INBOX'];
  var queue = await thread.getQueue();
  if (queue)
    removeLabelIds.push(await getLabelId(queue));
  await thread.modify(addLabelIds, removeLabelIds);
}

function getContentContainer() {
  return document.getElementById('content');
}

function getSubjectContainer() {
  return document.getElementById('subject');
}

function renderAllDone() {
  getContentContainer().textContent = 'All done triaging! \\o/ Reload to check for new threads.';
  getSubjectContainer().textContent = '';
}

async function renderNextThread() {
  g_state.currentThread = g_state.threads.pop();

  if (!g_state.currentThread) {
    renderAllDone();
    return;
  }

  updateCounter();
  getSubjectContainer().textContent = await g_state.currentThread.getSubject();

  var content = getContentContainer();
  content.textContent = '';

  let messages = await g_state.currentThread.getMessages();
  var lastMessageElement;
  for (var message of messages) {
    lastMessageElement = renderMessage(message);
    content.append(lastMessageElement);
  }
  var elementToScrollTo = document.querySelector('.unread') || lastMessageElement;
  elementToScrollTo.scrollIntoView();
  // Make sure that there's at least 50px of space above for showing that there's a
  // previous message.
  let y = elementToScrollTo.getBoundingClientRect().y;
  if (y < 70)
    document.documentElement.scrollTop -= 70 - y;

  g_state.threads.prefetchFirst();
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

  let rawThreads = await getPageOfThreads();
  let threads = [];
  for (let thread of rawThreads) {
    threads.push(new Thread(thread));
  }
  return threads;
}

function showLoader(show) {
  document.getElementById('loader').style.display = show ? 'inline-block' : 'none';
  if (!show);
    updateTitle('');
}

async function addThread(thread) {
  await g_state.threads.push(thread);
}

async function updateThreadList() {
  showLoader(true);
  resetThreadList();

  updateTitle('Fetching threads to triage...');
  await updateLabelList();

  let threads = await fetchThreads('inbox');
  let firstThread = threads.pop();
  if (firstThread)
    await addThread(firstThread);

  for (let thread of threads) {
    await addThread(thread);
  }

  if (!g_state.currentThread)
    renderAllDone();

  await processMail();
  showLoader(false);
}

async function processMail() {
  updateTitle('Processing mail backlog...');
  // TODO: Move this to a cron
  let mailProcessor = new MailProcessor(await getSettings(), g_state.threads);
  await mailProcessor.processMail();
  await mailProcessor.processQueues();

  // TODO: Move this to a cron, but for now at least do it after all the other network work.
  mailProcessor.collapseStats();
}

let TEN_MINUTES_IN_MS = 1000 * 60 * 10;
setInterval(processMail, TEN_MINUTES_IN_MS);

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
