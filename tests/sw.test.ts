import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

type Handler = (event: Record<string, unknown>) => void;

/** Runs web/sw.js against a small fake browser so we can see exactly what it stores. */
function loadWorker(network: (url: string) => Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (request: unknown): string => (typeof request === 'string' ? request : String((request as { url: string }).url));
  const open = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name) as Map<string, Response>;
    return {
      put: async (request: unknown, response: Response) => void store.set(new URL(keyOf(request), 'https://sales.test').href, response),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request: unknown) => store.delete(new URL(keyOf(request), 'https://sales.test').href),
    };
  };
  const caches = {
    open: async (name: string) => open(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: unknown) => {
      const href = new URL(keyOf(request), 'https://sales.test').href;
      for (const store of stores.values()) {
        const hit = store.get(href);
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const networkCalls: string[] = [];
  const fetchStub = async (request: unknown) => {
    const url = new URL(keyOf(request), 'https://sales.test').href;
    networkCalls.push(url);
    return network(url);
  };
  const self = {
    location: { origin: 'https://sales.test' },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: () => undefined,
    clients: { claim: () => undefined },
  };
  vm.runInNewContext(readFileSync(path.join(loadConfig().webDir, 'sw.js'), 'utf8'), { self, caches, fetch: fetchStub, Response, URL, Promise, Map, Array });

  /** Sends a request through the worker; returns undefined when the worker leaves it alone. */
  async function request(url: string, init: { mode?: string; method?: string } = {}): Promise<Response | undefined> {
    let answer: Promise<Response> | undefined;
    handlers.get('fetch')?.({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: (p: Promise<Response>) => (answer = p) });
    return answer;
  }
  async function lifecycle(type: 'install' | 'activate'): Promise<void> {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({ waitUntil: (p: Promise<unknown>) => (work = p) });
    await work;
  }
  const stored = (): string[] => [...stores.values()].flatMap((s) => [...s.keys()]);
  return { request, lifecycle, stores, stored, networkCalls };
}

const ok = (body: string) => async () => new Response(body, { status: 200 });

describe('service worker', () => {
  it('never keeps signed-in pages, and only shows the offline page when there is no connection', async () => {
    const worker = loadWorker(ok('<html>private leads</html>'));
    await worker.lifecycle('install');
    for (const page of ['/app', '/admin', '/manager', '/login']) {
      const res = await worker.request(`https://sales.test${page}`, { mode: 'navigate' });
      assert.equal(await res?.text(), '<html>private leads</html>', 'pages come from the network');
    }
    assert.ok(!worker.stored().some((url) => /\/(app|admin|manager|login)$/.test(url)), 'no page was stored');

    const offline = loadWorker(async () => {
      throw new Error('offline');
    });
    offline.stores.set('static-fynix-v2', new Map([['https://sales.test/offline.html', new Response('You are offline')]]));
    const res = await offline.request('https://sales.test/app', { mode: 'navigate' });
    assert.equal(await res?.text(), 'You are offline');
  });

  it('leaves data requests alone, so nothing from the API is ever stored', async () => {
    const worker = loadWorker(ok('{"leads":["secret"]}'));
    for (const url of ['/api/sales/bootstrap', '/api/admin/leads?page=1', '/api/auth/me', '/api/manager/verifications']) {
      assert.equal(await worker.request(`https://sales.test${url}`), undefined, `${url} is not intercepted`);
    }
    assert.equal(worker.stored().length, 0);
  });

  it('keeps public files for next time, and ignores anything that is not a GET', async () => {
    const worker = loadWorker(ok('console.log(1)'));
    const first = await worker.request('https://sales.test/assets/js-abc/sales.js');
    assert.equal(await first?.text(), 'console.log(1)');
    assert.equal(worker.networkCalls.length, 1);
    const second = await worker.request('https://sales.test/assets/js-abc/sales.js');
    assert.equal(await second?.text(), 'console.log(1)');
    assert.equal(worker.networkCalls.length, 1, 'the second time comes from the cache');
    assert.equal(await worker.request('https://sales.test/assets/x.js', { method: 'POST' }), undefined);
    assert.equal(await worker.request('https://elsewhere.test/script.js'), undefined, 'other sites are not touched');
  });

  it('deletes what older versions stored, including any pages and data', async () => {
    const worker = loadWorker(ok('x'));
    worker.stores.set('dynamic-fynix-v1', new Map([['https://sales.test/api/sales/bootstrap', new Response('{"leads":["secret"]}')]]));
    worker.stores.set('static-fynix-v1', new Map([['https://sales.test/app', new Response('<html>old page</html>')]]));
    await worker.lifecycle('install');
    await worker.lifecycle('activate');
    assert.deepEqual([...worker.stores.keys()], ['static-fynix-v2']);
    assert.ok(!worker.stored().some((url) => /bootstrap|\/app$/.test(url)));
  });
});
