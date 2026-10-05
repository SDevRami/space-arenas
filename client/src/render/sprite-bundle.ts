/** One-request sprite bundle support. The LAN host serves every game PNG
 *  concatenated with a JSON header; on slow/hotspot links (often ~1s per file
 *  when the WAN is down) the client swaps to this single fetch and builds all
 *  textures locally, so the offline preload stops crawling file-by-file.
 *
 *  Wire format (mirrors host/src/index.ts buildSpriteBundle):
 *    0..4   u32LE  header length in bytes
 *    4...   JSON   Array<[relativePath, offset, length]>
 *    ...end        raw PNG bytes (offsets are into this trailing region)
 */

export interface SpriteBundle {
  byPath: Map<string, [offset: number, length: number]>
  bytes: Uint8Array
}

let cached: SpriteBundle | null = null

export const fetchSpritesBundle = async (url?: string): Promise<SpriteBundle | null> => {
  if (cached) return cached
  try {
    const res = await fetch(url ?? `${import.meta.env.BASE_URL}assets/sprites.bundle`)
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length < 4) return null
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const headerLen = view.getUint32(0, true)
    const headerEnd = 4 + headerLen
    if (headerEnd > buf.length) return null
    const manifest = JSON.parse(new TextDecoder().decode(buf.subarray(4, headerEnd))) as Array<[string, number, number]>
    const byPath = new Map<string, [number, number]>()
    for (const [p, o, l] of manifest) byPath.set(p, [o, l])
    cached = { byPath, bytes: buf.subarray(headerEnd) }
    return cached
  } catch {
    return null
  }
}

/** Bytes for a dist-relative path (e.g. "cc/1/cc_0001.png"), or null when absent. */
export const spriteBundleBytes = (bundle: SpriteBundle, relPath: string): Uint8Array | null => {
  const hit = bundle.byPath.get(relPath)
  if (!hit) return null
  const [offset, length] = hit
  if (offset + length > bundle.bytes.length) return null
  return bundle.bytes.subarray(offset, offset + length)
}