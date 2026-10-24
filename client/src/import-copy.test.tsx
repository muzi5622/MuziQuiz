// @vitest-environment happy-dom
import { act,createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect,it,vi } from 'vitest';
import { ImportGuide,quizPrompt } from './import-guide.js';

it('copies exactly the quiz prompt on an insecure LAN and keeps JSON structure collapsed',async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  const show = vi.spyOn(HTMLDialogElement.prototype,'showModal').mockImplementation(() => {});
  const close = vi.spyOn(HTMLDialogElement.prototype,'close').mockImplementation(() => {});
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator,'clipboard');
  Object.defineProperty(navigator,'clipboard',{ configurable:true,value:undefined });
  const copy = vi.fn(() => true);
  const oldCopy = Object.getOwnPropertyDescriptor(document,'execCommand');
  Object.defineProperty(document,'execCommand',{ configurable:true,value:copy });
  const element=document.createElement('div');document.body.append(element); const root=createRoot(element);
  try {
    await act(async () => root.render(createElement(ImportGuide,{ busy:false,error:'',onChoose:() => {},onClose:() => {} })));
    expect(element.querySelector<HTMLDetailsElement>('.format-example')!.open).toBe(false);
    await act(async () => Array.from(element.querySelectorAll('button')).find(button => button.textContent === 'Copy AI prompt')!.click());
    const field=element.querySelector<HTMLTextAreaElement>('#quiz-ai-prompt')!;
    expect(copy).toHaveBeenCalledWith('copy'); expect(document.activeElement).toBe(field);
    expect(field.value.slice(field.selectionStart,field.selectionEnd)).toBe(quizPrompt);
    expect(element.textContent).toContain('Quiz-writing prompt copied.');
  } finally {
    await act(async () => root.unmount());element.remove(); show.mockRestore();close.mockRestore();
    if (oldClipboard) Object.defineProperty(navigator,'clipboard',oldClipboard); else Reflect.deleteProperty(navigator,'clipboard');
    if (oldCopy) Object.defineProperty(document,'execCommand',oldCopy); else Reflect.deleteProperty(document,'execCommand');
    vi.unstubAllGlobals();
  }
});
