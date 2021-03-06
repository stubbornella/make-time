import { AsyncOnce } from './AsyncOnce.js';
import { ErrorLogger } from './ErrorLogger.js';
import { Labels } from './Labels.js';
import { Router } from './Router.js';
import { ThreadGroups } from './ThreadGroups.js';
import { Settings } from './Settings.js';
import { ThreadCache } from './ThreadCache.js';
import { QueueSettings } from './QueueSettings.js';
import { Thread } from './Thread.js';
import { View } from './views/View.js';
import { IDBKeyVal } from './idb-keyval.js';

// Client ID and API key from the Developer Console
let CLIENT_ID: string;
let isGoogle = location.toString().includes(':5555/') || location.toString().includes('https://com-mktime');
if (isGoogle)
  CLIENT_ID = '800053010416-p1p6n47o6ovdm04329v9p8mskl618kuj.apps.googleusercontent.com';
else
  CLIENT_ID = '475495334695-0i3hbt50i5lj8blad3j7bj8j4fco8edo.apps.googleusercontent.com';

// Array of API discovery doc URLs for APIs used by the quickstart
let DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    "https://sheets.googleapis.com/$discovery/rest?version=v4",
    "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
let SCOPES = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets https://www.google.com/m8/feeds https://www.googleapis.com/auth/drive.metadata.readonly';

export let USER_ID = 'me';

let isSignedIn_ = false;
let loginDialog_: HTMLDialogElement;
let currentView_: View;
let settings_: Settings;
let labels_: Labels;
let queuedLabelMap_: QueueSettings;
let threadCache_: ThreadCache;
let contacts_: Contact[] = [];
let titleStack_: any[] = [];
let loaderTitleStack_: any[] = [];
let isProcessingMail_ = false;
let threads_ = new ThreadGroups();
let WEEKS_TO_STORE_ = 2;

var router = new Router();

async function routeToCurrentLocation() {
  await router.run(window.location, true);
}

window.onpopstate = () => {
  routeToCurrentLocation();
}

router.add('/compose', async (params) => {
  if (currentView_)
    currentView_.tearDown();
  await viewCompose(params);
});
router.add('/', routeToTriage);
router.add('/triage', routeToTriage);
router.add('/make-time', async (_params) => {
  if (currentView_)
    currentView_.tearDown();
  await viewMakeTime();
});
// TODO: best-effort should not be a URL since it's not a proper view.
// or should it be a view instead?
router.add('/best-effort', async (_params) => {
  if (currentView_)
    currentView_.tearDown();

  threads_.processBestEffort();
  await router.run('/triage');
});

async function routeToTriage() {
  if (currentView_)
    currentView_.tearDown();
  await viewTriage();
}

let DRAWER_OPEN = 'drawer-open';
let CURRENT_PAGE_CLASS = 'current-page';

function showBackArrow(show: boolean) {
  (<HTMLElement> document.getElementById('hambuger-menu-toggle')).style.display = show ? 'none' : '';
  (<HTMLElement> document.getElementById('back-arrow')).style.display = show ? '' : 'none';
}

function openMenu() {
  let drawer = <HTMLElement> document.getElementById('drawer');
  let menuItems = <NodeListOf<HTMLAnchorElement>> drawer.querySelectorAll('a.item');
  for (let item of menuItems) {
    if (item.pathname == location.pathname) {
      item.classList.add(CURRENT_PAGE_CLASS);
    } else {
      item.classList.remove(CURRENT_PAGE_CLASS);
    }
  }

  let mainContent = <HTMLElement> document.getElementById('main-content');
  mainContent.classList.add(DRAWER_OPEN);
}

function closeMenu() {
  let mainContent = <HTMLElement> document.getElementById('main-content');
  mainContent.classList.remove(DRAWER_OPEN);
}

function toggleMenu() {
  let mainContent = <HTMLElement> document.getElementById('main-content');
  if (mainContent.classList.contains(DRAWER_OPEN))
    closeMenu();
  else
    openMenu();
}

(<HTMLElement> document.getElementById('back-arrow')).addEventListener('click', async () => {
  if (currentView_.goBack)
    await currentView_.goBack();
});

(<HTMLElement> document.getElementById('hambuger-menu-toggle')).addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu();
});

(<HTMLElement> document.getElementById('main-content')).addEventListener('click', (e) => {
  let mainContent = <HTMLElement> document.getElementById('main-content');
  if (mainContent.classList.contains(DRAWER_OPEN)) {
    e.preventDefault();
    closeMenu();
  }
})

export function showDialog(contents: HTMLElement) {
  let dialog = document.createElement('dialog');
  // Subtract out the top/bottom, padding and border from the max-height.
  dialog.style.cssText = `
    top: 15px;
    padding: 8px;
    border: 3px solid grey;
    max-height: calc(100vh - 30px - 16px - 6px);
    max-width: 800px;
    position: fixed;
    display: flex;
    overscroll-behavior: none;
  `;
  dialog.addEventListener('close', () => dialog.remove());

  dialog.append(contents);
  document.body.append(dialog);

  dialog.showModal();
  return dialog;
}

async function viewCompose(params: any) {
  let ComposeView = (await import('./views/ComposeView.js')).ComposeView;
  await setView(new ComposeView(contacts_, updateLoaderTitle, params));
}

async function viewTriage() {
  updateLoaderTitle('viewTriage', 'Fetching threads to triage...');
  let TriageView = (await import('./views/TriageView.js')).TriageView;

  let settings = await getSettings();
  let ServerStorage = await serverStorage();
  let autoStartTimer = settings.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timerDuration = settings.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =  settings.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);
  let vacation = settings.get(ServerStorage.KEYS.VACATION);
  await setView(new TriageView(threads_, await getMailProcessor(), getScroller(), await getLabels(), vacation, updateLoaderTitle, setSubject, showBackArrow, allowedReplyLength, contacts_, autoStartTimer, timerDuration, await getQueuedLabelMap()));

  updateLoaderTitle('viewTriage', '');
}

async function viewMakeTime() {
  let MakeTimeView = (await import('./views/MakeTimeView.js')).MakeTimeView;

  let settings = await getSettings();
  let ServerStorage = await serverStorage();
  let autoStartTimer = settings.get(ServerStorage.KEYS.AUTO_START_TIMER);
  let timerDuration = settings.get(ServerStorage.KEYS.TIMER_DURATION);
  let allowedReplyLength =  settings.get(ServerStorage.KEYS.ALLOWED_REPLY_LENGTH);
  let vacation = settings.get(ServerStorage.KEYS.VACATION);
  await setView(new MakeTimeView(threads_, await getMailProcessor(), getScroller(), await getLabels(), vacation, updateLoaderTitle, setSubject, showBackArrow, allowedReplyLength, contacts_, autoStartTimer, timerDuration));
}

async function setView(view: View) {
  threads_.setListener(view);
  currentView_ = view;

  var content = <HTMLElement> document.getElementById('content');
  content.textContent = '';
  content.append(view);

  await login();
  await view.fetch();
}

function getScroller() {
  return <HTMLElement> document.getElementById('content');
}

async function updateSigninStatus(isSignedIn: boolean) {
  isSignedIn_ = isSignedIn;
  if (isSignedIn_) {
    if (loginDialog_)
      loginDialog_.close();
    if (queuedLogin_)
      queuedLogin_();
  } else {
    let loginButton = document.createElement('button');
    loginButton.style.cssText = `font-size: 40px;`;
    loginButton.textContent = 'Log In';
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    loginButton.onclick = () => gapi.auth2.getAuthInstance().signIn();
    loginDialog_ = showDialog(loginButton);
  }
}

function setSubject(...items: (string | Node)[]) {
  let subject = <HTMLElement> document.getElementById('subject');
  subject.textContent = '';
  subject.append(...items);
}

function updateTitle(key: string, ...opt_title: string[]) {
  let node = document.getElementById('title');
  updateTitleBase(titleStack_, node!, key, ...opt_title);
}

function updateLoaderTitle(key: string, ...opt_title: string[]) {
  let node = document.getElementById('loader-title');
  updateTitleBase(loaderTitleStack_, node!, key, ...opt_title);

  let titleContainer = <HTMLElement> document.getElementById('loader');
  titleContainer.style.display = loaderTitleStack_.length ? '' : 'none';
}

function updateTitleBase(stack: any[], node: HTMLElement, key: string, ...opt_title: string[]) {
  let index = stack.findIndex((item) => item.key == key);
  if (!opt_title[0]) {
    if (index != -1)
      stack.splice(index, 1);
  } else if (index == -1) {
    stack.push({
      key: key,
      title: opt_title,
    });
  } else {
    let entry = stack[index];
    entry.title = opt_title;
  }

  node.textContent = '';
  if (stack.length)
    node.append(...stack[stack.length - 1].title);
}

export async function fetchThread(id: string) {
  let requestParams = {
    'userId': USER_ID,
    'id': id,
  };
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let resp = await gapiFetch(gapi.client.gmail.users.threads.get, requestParams);
  let thread = await getCachedThread(resp.result, await getLabels());
  // If we have a stale thread we just fetched, then it's not stale anymore.
  // This can happen if we refetch a thread that wasn't actually modified
  // by a modify call.
  thread.stale = false;
  return thread;
}

interface FetchRequestParameters {
  userId: string;
  q: string;
  pageToken: string;
}

export async function fetchThreads(forEachThread: (thread: Thread) => void, options: any) {
  // Chats don't expose their bodies in the gmail API, so just skip them.
  let query = '-in:chats ';

  if (options.query)
    query += ' ' + options.query;

  let ServerStorage = await serverStorage();
  let daysToShow = (await getSettings()).get(ServerStorage.KEYS.DAYS_TO_SHOW);
  if (daysToShow)
    query += ` newer_than:${daysToShow}d`;

  let labels = await getLabels();

  let getPageOfThreads = async (opt_pageToken?: string) => {
    let requestParams = <FetchRequestParameters> {
      'userId': USER_ID,
      'q': query,
    };

    if (opt_pageToken)
      requestParams.pageToken = opt_pageToken;

    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    let resp = await gapiFetch(gapi.client.gmail.users.threads.list, requestParams);
    let threads = resp.result.threads || [];
    for (let rawThread of threads) {
      let thread = await getCachedThread(rawThread, labels);
      await forEachThread(thread);
    }

    let nextPageToken = resp.result.nextPageToken;
    if (nextPageToken)
      await getPageOfThreads(nextPageToken);
  };

  await getPageOfThreads();
}

async function isBestEffortQueue(thread: Thread) {
  let queue = await thread.getQueue();
  let parts = queue.split('/');
  let lastPart = parts[parts.length - 1];
  let data = (await getQueuedLabelMap()).get(lastPart);
  return data && data.goal == 'Best Effort';
}

// This function is all gross and hardcoded. Also, the constants themselves
// aren't great. Would be best to know how long the email was actually in the
// inbox rather than when the last email was sent, e.g. if someone was on vacation.
// Could track the last N dequeue dates for each queue maybe?
async function isBankrupt(thread: Thread) {
  let messages = await thread.getMessages();
  let date = messages[messages.length - 1].date;
  let queue = await thread.getQueue();
  let queueData = (await getQueuedLabelMap()).get(queue);

  let numDays = 7;
  let QueueSettings = await queueSettings();
  if (queueData.queue == QueueSettings.WEEKLY)
    numDays = 14;
  else if (queueData.queue == QueueSettings.MONTHLY)
    numDays = 42;

  let oneDay = 24 * 60 * 60 * 1000;
  let diffDays = (Date.now() - date.getTime()) / (oneDay);
  return diffDays > numDays;
}

async function bankruptThread(thread: Thread) {
  let queue = await thread.getQueue();
  queue = Labels.removeNeedsTriagePrefix(queue);
  let newLabel = Labels.addBankruptPrefix(queue);
  await thread.markTriaged(newLabel);
}

// TODO: Don't export this.
export async function addThread(thread: Thread) {
  // Don't ever show best effort threads when on vacation.
  let settings = await getSettings();
  let ServerStorage = await serverStorage();
  let vacation = settings.get(ServerStorage.KEYS.VACATION);

  if (!vacation && threads_.getBestEffort() && await isBestEffortQueue(thread)) {
    if (await isBankrupt(thread)) {
      await bankruptThread(thread);
      return;
    } else if (threads_.getBestEffort()) {
      // Check again that getBestEffort is non-null in case best effort threads started being
      // triaged in the async time from the threads_.getBestEffort() call above.
      threads_.pushBestEffort(thread);
      return;
    }
  }

  await currentView_.addThread(thread);
}

function createMenuItem(name: string, options: any) {
  let a = document.createElement('a');
  a.append(name);
  a.className = 'item';

  if (options.nested)
    a.classList.add('nested');

  if (options.href)
    a.href = options.href;

  if (options.onclick)
    a.onclick = options.onclick;

  a.addEventListener('click', closeMenu);

  return a;
}

async function gapiFetch(method: any, requestParams: any, opt_requestBody: any) {
  let fetcher = (await import('./Net.js')).gapiFetch;
  return fetcher(method, requestParams, opt_requestBody);
}

async function queueSettings() {
  return (await import('./QueueSettings.js')).QueueSettings;
}

async function serverStorage() {
  return (await import('./ServerStorage.js')).ServerStorage;
}

async function getCachedThread(response: any, labels: Labels) {
  let ThreadCache = (await import('./ThreadCache.js')).ThreadCache;
  if (!threadCache_)
    threadCache_ = new ThreadCache();
  return threadCache_.get(response, labels);
}

async function getLabels() {
  await fetchTheSettingsThings();
  return labels_;
}

async function getSettings() {
  await fetchTheSettingsThings();
  return settings_;
}

async function showHelp() {
  let help = await import('./help.js');
  help.showHelp();
}

let settingThingsFetcher_: AsyncOnce;
async function fetchTheSettingsThings() {
  if (!settingThingsFetcher_) {
    settingThingsFetcher_ = new AsyncOnce(async () => {
      if (settings_ || labels_)
        throw 'Tried to fetch settings or labels twice.';

      await login();

      let Settings = (await import('./Settings.js')).Settings;
      settings_ = new Settings();
      labels_ = new Labels();

      // Don't await this here so we fetch settings in parallel.
      let labelsPromise = labels_.fetch();

      await settings_.fetch();

      let ServerStorage = await serverStorage();
      let storage = new ServerStorage(settings_.spreadsheetId);
      if (!storage.get(ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN)) {
        await showHelp();
        storage.writeUpdates([{key: ServerStorage.KEYS.HAS_SHOWN_FIRST_RUN, value: true}]);
      }

      await labelsPromise;
      await migrateLabels(labels_);
    });
  }
  await settingThingsFetcher_.do();
}

async function migrateLabels(labels: Labels) {
  // Rename parent labesl before sublabels.
  await labels.rename(Labels.OLD_MAKE_TIME_PREFIX, Labels.MAKE_TIME_PREFIX);
  await labels.rename(Labels.OLD_TRIAGED_LABEL, Labels.TRIAGED_LABEL);
  await labels.rename(Labels.OLD_QUEUED_LABEL, Labels.QUEUED_LABEL);

  await labels.rename(Labels.OLD_PRIORITY_LABEL, Labels.PRIORITY_LABEL);
  await labels.rename(Labels.OLD_NEEDS_TRIAGE_LABEL, Labels.NEEDS_TRIAGE_LABEL);
  await labels.rename(Labels.OLD_PROCESSED_LABEL, Labels.PROCESSED_LABEL);
  await labels.rename(Labels.OLD_MUTED_LABEL, Labels.MUTED_LABEL);
}

async function onLoad() {
  let settingsButton = createMenuItem('Settings', {
    onclick: async () => {
      let SettingsView = (await import('./views/Settings.js')).SettingsView;
      new SettingsView(await getSettings(), await getQueuedLabelMap());
    }
  });

  let helpButton = createMenuItem('Help', {
    onclick: async () => showHelp(),
  });

  let menuTitle = document.createElement('div');
  menuTitle.append('MakeTime phases');

  (<HTMLElement>document.getElementById('drawer')).append(
    menuTitle,
    createMenuItem('Compose', {href: '/compose', nested: true}),
    createMenuItem('Triage', {href: '/triage', nested: true}),
    createMenuItem('MakeTime', {href: '/make-time', nested: true}),
    settingsButton,
    helpButton);

  await routeToCurrentLocation();

  // Don't want to show the earlier title, but still want to indicate loading is happening.
  // since we're going to processMail still. It's a less jarring experience if the loading
  // spinner doesn't go away and then come back when conteacts are done being fetched.
  updateLoaderTitle('onLoad', '\xa0');

  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  await fetchContacts(gapi.auth.getToken());

  update();
  // Wait until we've fetched all the threads before trying to process updates regularly.
  setInterval(update, 1000 * 60);

  updateLoaderTitle('onLoad');
}

onLoad();

let CONTACT_STORAGE_KEY_ = 'contacts';

interface Contact {
  name: string;
  emails: string[];
}

async function fetchContacts(token: any) {
  if (contacts_.length)
    return;

  let idb = await idbKeyVal();

  // This is 450kb! Either cache this and fetch infrequently, or find a way of getting the API to not send
  // the data we don't need.
  let response;
  try {
    response = await fetch("https://www.google.com/m8/feeds/contacts/default/thin?alt=json&access_token=" + token.access_token + "&max-results=20000&v=3.0");
  } catch(e) {
    let message = `Failed to fetch contacts. Google Contacts API is hella unsupported. See https://issuetracker.google.com/issues/115701813.`;

    let contacts = await idb.get(CONTACT_STORAGE_KEY_);
    if (!contacts) {
      ErrorLogger.log(message);
      return;
    }

    ErrorLogger.log(`Using locally stored version of contacts. ${message}`);

    // Manually copy each contact instead of just assigning because contacts_ is passed
    // around and stored.
    let parsed = JSON.parse(contacts);
    for (let contact of parsed) {
      contacts_.push(contact);
    }
    return;
  }

  let json = await response.json();
  for (let entry of json.feed.entry) {
    if (!entry.gd$email)
      continue;
    let contact = <Contact> {};
    if (entry.title.$t)
      contact.name = entry.title.$t;
    contact.emails = [];
    for (let email of entry.gd$email) {
      contact.emails.push(email.address);
    }
    contacts_.push(contact);
  }

  // Store the final contacts object instead of the data fetched off the network since the latter
  // can is order of magnitude larger and can exceed the allowed localStorage quota.
  await idb.set(CONTACT_STORAGE_KEY_, JSON.stringify(contacts_));
}

let queueSettingsFetcher_: AsyncOnce;
async function getQueuedLabelMap() {
  if (!queueSettingsFetcher_) {
    queueSettingsFetcher_ = new AsyncOnce(async () => {
      let QueueSettings = await queueSettings();
      queuedLabelMap_ = new QueueSettings((await getSettings()).spreadsheetId);
      await queuedLabelMap_.fetch();
    });
  }
  await queueSettingsFetcher_.do();
  return queuedLabelMap_;
}

async function getMailProcessor() {
  let MailProcessor = (await import('./MailProcessor.js')).MailProcessor;
  return new MailProcessor(await getSettings(), addThread, await getQueuedLabelMap(), await getLabels(), updateLoaderTitle);
}

// TODO: Move this to a helper file with all the other async import things so that they're all in
// one file that is imported instead of duplicated across the codebase.
let idbKeyVal_: IDBKeyVal;
async function idbKeyVal() {
  let IDBKeyVal = (await import('./idb-keyval.js')).IDBKeyVal;
  if (!idbKeyVal_)
    idbKeyVal_ = IDBKeyVal.getDefault();
  return idbKeyVal_;
}

// TODO: Move this to a cron
async function processMail() {
  if (isProcessingMail_)
    return;

  isProcessingMail_ = true;

  let mailProcessor = await getMailProcessor();
  await mailProcessor.processUnprocessed();
  await mailProcessor.processQueues();
  await mailProcessor.collapseStats();

  isProcessingMail_ = false;
}

// TODO: Put this somewhere better.
export function getCurrentWeekNumber() {
  let today = new Date();
  var januaryFirst = new Date(today.getFullYear(), 0, 1);
  var msInDay = 86400000;
  // @ts-ignore TODO: Make subtracting date types from each other actually work.
  return Math.ceil((((today - januaryFirst) / msInDay) + januaryFirst.getDay()) / 7);
}

async function gcLocalStorage() {
  let ServerStorage = await serverStorage();
  let storage = new ServerStorage((await getSettings()).spreadsheetId);
  let lastGCTime = storage.get(ServerStorage.KEYS.LAST_GC_TIME);
  let oneDay = 24 * 60 * 60 * 1000;
  if (!lastGCTime || Date.now() - lastGCTime > oneDay) {
    let currentWeekNumber = getCurrentWeekNumber();
    let idb = await idbKeyVal();
    let keys = await idb.keys();
    for (let key of keys) {
      let match = key.match(/^thread-(\d+)-\d+$/);
      if (!match)
        continue;

      let weekNumber = Number(match[1]);
      if (weekNumber + WEEKS_TO_STORE_ < currentWeekNumber)
        await idb.del(key);
    }
    await storage.writeUpdates([{key: ServerStorage.KEYS.LAST_GC_TIME, value: Date.now()}]);
  }
}

export async function update() {
  if (currentView_.update)
    await currentView_.update();
  await processMail();
  await gcLocalStorage();
}

// Make sure links open in new tabs.
document.body.addEventListener('click', async (e) => {
  for (let node of e.path) {
    if (node.tagName == 'A') {
      let anchor = <HTMLAnchorElement> node;
      let willHandlePromise = router.run(anchor);
      if (willHandlePromise) {
        // Need to preventDefault before the await, otherwise the browsers
        // default action kicks in.
        e.preventDefault();
        await willHandlePromise;
        return;
      }
      anchor.target = '_blank';
      anchor.rel = 'noopener';
    }
  }
});

// This list is probably not comprehensive.
let NON_TEXT_INPUT_TYPES = [
  'button',
  'checkbox',
  'file',
  'image',
  'radio',
  'submit',
];

function isEditable(element: Element) {
  if (element.tagName == 'INPUT' && !NON_TEXT_INPUT_TYPES.includes((<HTMLInputElement>element).type))
    return true;

  if (element.tagName == 'TEXTAREA')
    return true;

  let parent: Element | null = element;
  while (parent) {
    let userModify = getComputedStyle(parent).webkitUserModify;
    if (userModify && userModify.startsWith('read-write'))
      return true;
    parent = parent.parentElement;
  }

  return false;
}

document.body.addEventListener('keydown', async (e) => {
  if (!currentView_)
    return;

  if (isEditable(<Element>e.target))
    return;

  if (e.key == '?') {
    showHelp();
    return;
  }

  if (currentView_.dispatchShortcut && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey)
    await currentView_.dispatchShortcut(e);
});

function loadGapi() {
  return new Promise((resolve) => {
    // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
    gapi.load('client:auth2', () => resolve());
  });
};

let queuedLogin_: ((value?: {} | PromiseLike<{}> | undefined) => void);

async function login() {
  if (isSignedIn_)
    return;

  updateLoaderTitle('login', 'Logging in...');

  await loadGapi();
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  await gapi.client.init({
    discoveryDocs: DISCOVERY_DOCS,
    clientId: CLIENT_ID,
    scope: SCOPES
  });
  // Listen for sign-in state changes.
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  gapi.auth2.getAuthInstance().isSignedIn.listen(updateSigninStatus);
  // Handle the initial sign-in state.
  // @ts-ignore TODO: Figure out how to get types for gapi client libraries.
  let isSignedIn = gapi.auth2.getAuthInstance().isSignedIn.get();
  updateSigninStatus(isSignedIn);

  if (!isSignedIn) {
    await new Promise((resolve) => {
      if (queuedLogin_)
        throw 'login() was called twice while waiting for login to finish.'
      queuedLogin_ = resolve;
    });
  }

  updateLoaderTitle('login');
}

window.addEventListener('error', (e) => {
  var emailBody = 'Something went wrong...';
  if (e.body)
    emailBody += '\n' + e.body;
  if (e.error)
    emailBody += '\n' + e.error;
  if (e.stack)
    emailBody += '\n\n' + e.stack;
  ErrorLogger.log(emailBody);
});

window.addEventListener('unhandledrejection', (e) => {
  // 401 means the credentials are invalid and you probably need to 2 factor.
  if (e.reason && e.reason.status == 401)
    window.location.reload();
  ErrorLogger.log(e.reason);
});

window.addEventListener('offline', () => {
  updateTitle('offline', 'No network connection...');
});

window.addEventListener('online', () => {
  updateTitle('offline');
  update();
});
