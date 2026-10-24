import { useLocation } from 'react-router-dom';

/** Marker the desktop app recognises: open this page in the default browser instead of a new app window. */
export const OPEN_IN_BROWSER_MARKER = '#open-in-browser';
/** True inside the MuziQuiz Windows app (Electron), false in a normal browser. */
export const inDesktopApp = () => typeof navigator !== 'undefined' && /\bElectron\//.test(navigator.userAgent);

/** "Open in browser" shortcut shown only in the desktop app; opens the current page. */
export function OpenInBrowser({ className = 'open-in-browser' }: { className?: string }) {
  const location = useLocation();
  if (!inDesktopApp()) return null;
  const href = `${location.pathname}${location.search}${OPEN_IN_BROWSER_MARKER}`;
  return <a className={className} href={href} target="_blank" rel="noopener" title="Open this page in your web browser">Open in browser <span aria-hidden="true">↗</span></a>;
}
