let queuedRequests_: ((value?: {} | PromiseLike<{}> | undefined) => void)[] = [];
let TEN_SECONDS = 10 * 1000;

function backOnline() {
  return new Promise(resolve => queuedRequests_.push(resolve));
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

window.addEventListener('online', (_e) => {
  for (let request of queuedRequests_) {
    request();
  }
  queuedRequests_ = [];
});

export async function gapiFetch(method: any, requestParams: any, opt_requestBody?: any) {
  let numRetries = 3;
  for (var i = 0; i < numRetries; i++) {
    try {
      if (!navigator.onLine)
        await backOnline();
      return await method(requestParams, opt_requestBody);
    } catch (e) {
      console.log('Response failed.');
      if (i == numRetries - 1)
        throw e;
      await sleep(TEN_SECONDS);
    }
  }
}
