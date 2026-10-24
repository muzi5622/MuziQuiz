// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { OpenInBrowser } from './desktop.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(userAgent: string) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  const container = document.createElement('div'); const root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries:['/present/123456?x=1'] }, createElement(OpenInBrowser))));
  const link = container.querySelector('a'); await act(async () => root.unmount()); return link;
}
it('shows Open in browser only inside the desktop app, pointing at the current page', async () => {
  expect(await render('Mozilla/5.0 Chrome/150.0 Safari/537.36')).toBeNull();
  const link = await render('Mozilla/5.0 Chrome/152.0 MuziQuiz/0.1.1 Electron/44.7.0 Safari/537.36');
  expect(link?.getAttribute('href')).toBe('/present/123456?x=1#open-in-browser');
  expect(link?.target).toBe('_blank'); expect(link?.textContent).toContain('Open in browser');
});
