// Lightweight in-memory Firestore + helpers for tests

export function createMemoryFirestore() {
  const roots = new Map(); // collName -> Map(id -> doc)
  const api = { collection: name => collRef(name) };
  function collRef(name) {
    if (!roots.has(name)) roots.set(name, new Map());
    const map = roots.get(name);
    return {
      doc: id => docRef(map, id),
      async add(obj) {
        const id = Math.random().toString(36).slice(2, 12);
        const d = ensure(map, id);
        d.data = { ...(d.data || {}), ...clone(obj) };
        return { id };
      },
      orderBy(field, dir = 'asc') {
        return {
          async get() {
            const docs = Array.from(map.entries()).map(([id, d]) => ({ id, data: () => clone(d.data) }));
            docs.sort((a, b) => {
              const av = a.data()[field];
              const bv = b.data()[field];
              const cmp = (av > bv) - (av < bv);
              return dir === 'desc' ? -cmp : cmp;
            });
            return { docs };
          },
        };
      },
      async get() {
        const docs = Array.from(map.entries()).map(([id, d]) => ({ id, data: () => clone(d.data) }));
        return { docs };
      },
    };
  }
  function docRef(map, id) {
    return {
      async get() {
        const d = map.get(id);
        return d ? { exists: true, id, data: () => clone(d.data) } : { exists: false };
      },
      async set(obj, opts = {}) {
        const d = ensure(map, id);
        d.data = opts.merge ? { ...(d.data || {}), ...clone(obj) } : clone(obj);
      },
      async update(patch) {
        if (!map.has(id)) throw new Error('not-found');
        const d = map.get(id);
        d.data = { ...(d.data || {}), ...clone(patch) };
      },
      async delete() {
        map.delete(id);
      },
      collection(name) {
        const d = ensure(map, id);
        if (!d.subs) d.subs = new Map();
        if (!d.subs.has(name)) d.subs.set(name, new Map());
        return collRefSub(d.subs.get(name));
      },
    };
  }
  function collRefSub(map) {
    return {
      doc: id => docRef(map, id),
      async add(obj) {
        const id = Math.random().toString(36).slice(2, 12);
        const d = ensure(map, id);
        d.data = { ...(d.data || {}), ...clone(obj) };
        return { id };
      },
      orderBy(field, dir = 'asc') {
        return {
          async get() {
            const docs = Array.from(map.entries()).map(([id, d]) => ({ id, data: () => clone(d.data) }));
            docs.sort((a, b) => {
              const av = a.data()[field];
              const bv = b.data()[field];
              const cmp = (av > bv) - (av < bv);
              return dir === 'desc' ? -cmp : cmp;
            });
            return { docs };
          },
        };
      },
      async get() {
        const docs = Array.from(map.entries()).map(([id, d]) => ({ id, data: () => clone(d.data) }));
        return { docs };
      },
    };
  }
  function ensure(map, id) {
    if (!map.has(id)) map.set(id, { data: {}, subs: new Map() });
    return map.get(id);
  }
  const clone = v => JSON.parse(JSON.stringify(v));
  return api;
}

export const FieldValue = {
  serverTimestamp() { return new Date(); },
};

export const Timestamp = {
  fromDate(d) { return { toDate: () => d }; },
  now() { return { toDate: () => new Date() }; },
};

export const firestore = createMemoryFirestore();

