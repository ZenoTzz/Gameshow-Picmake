export function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("已取消", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
