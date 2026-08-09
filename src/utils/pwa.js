export function canRegisterServiceWorker(navigatorObject) {
  return Boolean(navigatorObject?.serviceWorker?.register);
}

export async function registerAppServiceWorker(navigatorObject) {
  if (!canRegisterServiceWorker(navigatorObject)) return null;

  return navigatorObject.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  });
}
