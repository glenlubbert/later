import { getStore } from "@netlify/blobs";

// One site-wide store. Keys:
//   auth      -> { salt, hash, sessions: [...], tokens: [...], fails, lockedUntil }
//   index     -> [ article meta, newest first ]
//   a/<id>    -> { content, textLength } (extracted article body)
export const store = () => getStore({ name: "later", consistency: "strong" });

export async function readIndex() {
  return (await store().get("index", { type: "json" })) ?? [];
}

// Read-modify-write guarded by the blob's etag, so two saves landing at the
// same moment (extension + phone) can't drop each other's entry.
export async function updateIndex(mutate) {
  const s = store();
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = await s.getWithMetadata("index", { type: "json" });
    const list = entry?.data ?? [];
    const result = await mutate(list);
    const next = result?.list ?? list;
    const opts = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
    const { modified } = await s.setJSON("index", next, opts);
    if (modified) return result?.value;
    await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
  }
  throw new Error("Could not update the article index, please retry");
}

export async function readAuth() {
  return await store().get("auth", { type: "json" });
}

export async function writeAuth(auth) {
  await store().setJSON("auth", auth);
}

export async function readBody(id) {
  return await store().get(`a/${id}`, { type: "json" });
}

export async function writeBody(id, body) {
  await store().setJSON(`a/${id}`, body);
}

export async function deleteBody(id) {
  await store().delete(`a/${id}`);
}
