export function getFullscreenElement(documentObject) {
  return (
    documentObject?.fullscreenElement ||
    documentObject?.webkitFullscreenElement ||
    null
  );
}

export function isFullscreenSupported(documentObject) {
  const target = documentObject?.documentElement;
  const canEnter = Boolean(
    target?.requestFullscreen || target?.webkitRequestFullscreen,
  );
  const canExit = Boolean(
    documentObject?.exitFullscreen || documentObject?.webkitExitFullscreen,
  );

  return canEnter && canExit;
}

export async function toggleDocumentFullscreen(documentObject) {
  if (!documentObject) return 'unsupported';

  if (getFullscreenElement(documentObject)) {
    const exitFullscreen =
      documentObject.exitFullscreen || documentObject.webkitExitFullscreen;

    if (!exitFullscreen) return 'unsupported';

    await exitFullscreen.call(documentObject);
    return 'exit';
  }

  const target = documentObject.documentElement;
  const requestFullscreen =
    target?.requestFullscreen || target?.webkitRequestFullscreen;

  if (!requestFullscreen) return 'unsupported';

  await requestFullscreen.call(target);
  return 'enter';
}
