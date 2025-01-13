// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce(callback: (...arg: any) => void, wait: number) {
  let timeoutId: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (...arg: any) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      callback(...arg);
    }, wait);
  };
}
