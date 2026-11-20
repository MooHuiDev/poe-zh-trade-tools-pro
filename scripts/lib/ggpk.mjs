// Minimal read-only reader for the standalone client's Content.ggpk (GGPK v3,
// Bundles2). Used by update-game-data.mjs. Never writes to the file.
import fs from 'node:fs'
import {
  decompressedBundleSize,
  decompressSliceInBundle,
  readIndexBundle,
  getDirContent,
  getFileInfo
} from 'pathofexile-dat/bundles.js'
import { readDatFile, readColumn } from 'pathofexile-dat/dat.js'

export function openGgpk(ggpkPath) {
  const fd = fs.openSync(ggpkPath, 'r')
  const readAt = (pos, len) => { const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, pos); return b }
  const tag = (off) => readAt(off, 8).toString('latin1', 4, 8)
  const pdir = (off) => {
    const h = readAt(off, 16); const nl = h.readUInt32LE(8), cnt = h.readUInt32LE(12)
    const name = readAt(off + 48, nl * 2).toString('utf16le').replace(/\0+$/, '')
    const eb = readAt(off + 48 + nl * 2, cnt * 12); const kids = []
    for (let i = 0; i < cnt; i++) kids.push(Number(eb.readBigUInt64LE(i * 12 + 4)))
    return { name, kids }
  }
  const finfo = (off) => {
    const h = readAt(off, 12); const len = h.readUInt32LE(0), nl = h.readUInt32LE(8)
    const name = readAt(off + 44, nl * 2).toString('utf16le').replace(/\0+$/, '')
    return { name, data: off + 44 + nl * 2, size: len - 44 - nl * 2 }
  }
  const cache = new Map()
  const listDir = (off) => {
    if (cache.has(off)) return cache.get(off)
    const m = new Map()
    for (const k of pdir(off).kids) {
      const t = tag(k)
      if (t === 'PDIR') m.set(pdir(k).name.toLowerCase(), { off: k })
      else if (t === 'FILE') { const f = finfo(k); m.set(f.name.toLowerCase(), { off: k, f }) }
    }
    cache.set(off, m); return m
  }
  const hdr = readAt(0, 28)
  if (hdr.toString('latin1', 4, 8) !== 'GGPK') throw new Error(`not a GGPK file: ${ggpkPath}`)
  const root = [Number(hdr.readBigUInt64LE(12)), Number(hdr.readBigUInt64LE(20))].find((o) => tag(o) === 'PDIR')
  const b2 = listDir(root).get('bundles2')
  if (!b2) throw new Error('Bundles2 not found in GGPK')
  const readBundlesFile = (rel) => {
    let cur = b2.off; const parts = rel.split('/')
    for (let i = 0; i < parts.length; i++) {
      const e = listDir(cur).get(parts[i].toLowerCase()); if (!e) throw new Error('not in GGPK: ' + rel)
      if (i === parts.length - 1) return new Uint8Array(readAt(e.f.data, e.f.size))
      cur = e.off
    }
  }
  const unbundle = (bin) => { const o = new Uint8Array(decompressedBundleSize(bin)); decompressSliceInBundle(bin, 0, o); return o }
  const index = readIndexBundle(unbundle(readBundlesFile('_.index.bin')))
  const pathReps = unbundle(index.pathRepsBundle)
  const bundleCache = new Map()
  const read = (p) => {
    const loc = getFileInfo(p, index.bundlesInfo, index.filesInfo); if (!loc) throw new Error('not in index: ' + p)
    let bin = bundleCache.get(loc.bundle); if (!bin) { bin = readBundlesFile(loc.bundle); bundleCache.set(loc.bundle, bin) }
    const o = new Uint8Array(loc.size); decompressSliceInBundle(bin, loc.offset, o); return o
  }
  return {
    read,
    has: (p) => !!getFileInfo(p, index.bundlesInfo, index.filesInfo),
    dir: (p) => getDirContent(p, pathReps, index.dirsInfo),
    /** One column of a .datc64 table. */
    column: (file, offset, type = { string: {} }) => readColumn({ offset, type }, readDatFile(file, read(file)))
  }
}

// Clients without a Content.ggpk (e.g. the Tencent 国服 client) keep the same
// bundles as loose files in a `Bundles2` folder. Same interface as openGgpk.
//   openBundlesDir('D:/Poe_CN/流放之路(511)/Bundles2')
// The 国服 client has `data/simplified chinese/` (official 简中 names).
export function openBundlesDir(bundlesDir) {
  const rb = (rel) => new Uint8Array(fs.readFileSync(`${bundlesDir}/${rel}`))
  const unbundle = (bin) => { const o = new Uint8Array(decompressedBundleSize(bin)); decompressSliceInBundle(bin, 0, o); return o }
  const index = readIndexBundle(unbundle(rb('_.index.bin')))
  const pathReps = unbundle(index.pathRepsBundle)
  const bundleCache = new Map()
  const read = (p) => {
    const loc = getFileInfo(p, index.bundlesInfo, index.filesInfo); if (!loc) throw new Error('not in index: ' + p)
    let bin = bundleCache.get(loc.bundle); if (!bin) { bin = rb(loc.bundle); bundleCache.set(loc.bundle, bin) }
    const o = new Uint8Array(loc.size); decompressSliceInBundle(bin, loc.offset, o); return o
  }
  return {
    read,
    has: (p) => !!getFileInfo(p, index.bundlesInfo, index.filesInfo),
    dir: (p) => getDirContent(p, pathReps, index.dirsInfo),
    column: (file, offset, type = { string: {} }) => readColumn({ offset, type }, readDatFile(file, read(file)))
  }
}
