import { describe, it, expect, beforeEach } from 'vitest';
import { PANELS, fmt } from '../../../runtime/v1/dash.js';

function makeApi(extra) {
  return Object.assign({ fmt, spec: null }, extra || {});
}
function makeState() { return { id: 's', update: () => {} }; }

describe('renderScript', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('mounts the html shell verbatim', () => {
    const state = makeState();
    const el = PANELS.script({
      type: 'script', id: 's',
      html: '<div id="drill-root">click me</div>',
      script: '',
    }, state, { api: makeApi() });
    expect(el.querySelector('#drill-root')).toBeTruthy();
    expect(el.querySelector('#drill-root').textContent).toBe('click me');
  });

  it('runs the script body and exposes DASH api', async () => {
    const state = makeState();
    const api = makeApi({ probe: 'ok' });
    const el = PANELS.script({
      type: 'script', id: 's',
      html: '<div id="r"></div>',
      script: "document.querySelector('#r').textContent = DASH.probe + '!';",
    }, state, { api });
    document.body.appendChild(el);
    await state.update();
    expect(document.querySelector('#r').textContent).toBe('ok!');
  });

  it('isolates a thrown error in the panel slot', async () => {
    const state = makeState();
    const el = PANELS.script({
      type: 'script', id: 's',
      html: '<div></div>',
      script: 'throw new Error("boom");',
    }, state, { api: makeApi() });
    document.body.appendChild(el);
    await state.update();
    expect(el.textContent).toContain('Script error');
    expect(el.textContent).toContain('boom');
  });

  it('runs the script body only once across multiple updates', async () => {
    const state = makeState();
    let invoked = 0;
    const api = makeApi({ ping: () => { invoked++; } });
    const el = PANELS.script({
      type: 'script', id: 's',
      html: '<div></div>',
      script: 'DASH.ping();',
    }, state, { api });
    document.body.appendChild(el);
    await state.update();
    await state.update();
    await state.update();
    expect(invoked).toBe(1);
  });

  it('script receives `panel` and `state` arguments', async () => {
    const state = makeState();
    state.bag = [];
    const el = PANELS.script({
      type: 'script', id: 's',
      html: '<div id="r"></div>',
      script: 'state.bag.push(panel.id); state.bag.push(state.id);',
    }, state, { api: makeApi() });
    document.body.appendChild(el);
    await state.update();
    expect(state.bag).toEqual(['s', 's']);
  });

  it('async/await inside the body is supported', async () => {
    const state = makeState();
    const el = PANELS.script({
      type: 'script', id: 's',
      html: '<div id="r"></div>',
      script: "await Promise.resolve(); document.querySelector('#r').textContent = 'after-await';",
    }, state, { api: makeApi() });
    document.body.appendChild(el);
    await state.update();
    expect(document.querySelector('#r').textContent).toBe('after-await');
  });
});
