// Simple in-memory Firestore mock sufficient for our services + session store tests

export function createMemoryFirestore() {
  const collections = new Map(); // name -> Map(id -> { data: {}, subs: Map })

  function getCollection(name) {
    if (!collections.has(name)) collections.set(name, new Map());
    const map = collections.get(name);
    return collectionRef(map);
  }

  function collectionRef(map) {
    return {
      doc(id) {
        return docRef(map, id);
      },
      async add(obj) {
        const id = Math.random().toString(36).slice(2, 12);
        const d = ensureDoc(map, id);
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
        return d
          ? { exists: true, id, data: () => clone(d.data) }
          : { exists: false };
      },
      async set(obj, opts = {}) {
        const d = ensureDoc(map, id);
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
        const d = ensureDoc(map, id);
        if (!d.subs) d.subs = new Map();
        if (!d.subs.has(name)) d.subs.set(name, new Map());
        return collectionRef(d.subs.get(name));
      },
    };
  }

  function ensureDoc(map, id) {
    if (!map.has(id)) map.set(id, { data: {}, subs: new Map() });
    return map.get(id);
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  return {
    collection: getCollection,
    _debug: { collections },
  };
}

export function makeTimestamp() {
  return {
    fromDate: (d) => ({ toDate: () => d }),
    now: () => ({ toDate: () => new Date() }),
  };
}

export function makeFieldValue() {
  let t = 0;
  return {
    serverTimestamp: () => new Date(Date.now() + (++t)),
  };
}

