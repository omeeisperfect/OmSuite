// OmSuite Windows — pure EPUB reader core (no Electron import, no deps).
// ZIP reading is done via zip-core (Node zlib + manual central directory).
// Parses META-INF/container.xml + content.opf, lists spine chapters, and
// renders chapter XHTML as plain text (tags stripped, paragraphs kept).
// DRM-protected EPUBs are not decrypted; that case is reported, not faked.

const zipCore = require('./zip-core');

function unescapeXml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function parseContainerXml(xml) {
  const m = /<rootfile[^>]*full-path=["']([^"']+)["']/i.exec(xml || '');
  if (!m) throw new Error('EPUB container.xml has no rootfile full-path.');
  return unescapeXml(m[1]);
}

function parseOpf(opfXml, opfDir) {
  const manifest = new Map();
  const itemRe = /<item[^>]*>/gi;
  let im;
  while ((im = itemRe.exec(opfXml)) !== null) {
    const tag = im[0];
    const id = /id=["']([^"']+)["']/.exec(tag);
    const href = /href=["']([^"']+)["']/.exec(tag);
    const media = /media-type=["']([^"']+)["']/.exec(tag);
    const props = /properties=["']([^"']+)["']/.exec(tag);
    if (id && href) manifest.set(id[1], { id: id[1], href: unescapeXml(href[1]), mediaType: media ? media[1] : '', properties: props ? props[1] : '' });
  }
  const spineRe = /<spine[^>]*>([\s\S]*?)<\/spine>/i.exec(opfXml);
  const spine = [];
  let spineToc = null;
  if (spineRe) {
    const tocM = /toc=["']([^"']+)["']/.exec(spineRe[0]);
    if (tocM) spineToc = tocM[1];
    const refRe = /<itemref[^>]*idref=["']([^"']+)["']/gi;
    let rm;
    while ((rm = refRe.exec(spineRe[1])) !== null) spine.push(rm[1]);
  }
  const titleM = /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opfXml);
  const creatorM = /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i.exec(opfXml);
  const langM = /<dc:language[^>]*>([\s\S]*?)<\/dc:language>/i.exec(opfXml);
  const chapters = [];
  for (const idref of spine) {
    const item = manifest.get(idref);
    if (!item) continue;
    const full = opfDir ? opfDir + '/' + item.href : item.href;
    chapters.push({ id: idref, href: item.href, path: full, mediaType: item.mediaType });
  }
  return {
    title: titleM ? unescapeXml(titleM[1].replace(/<[^>]+>/g, '').trim()) : '',
    creator: creatorM ? unescapeXml(creatorM[1].replace(/<[^>]+>/g, '').trim()) : '',
    language: langM ? langM[1].trim() : '',
    chapters,
    manifest,
    spineToc,
  };
}

// Table of contents: EPUB 2 NCX navMap first, then an EPUB 3 nav document
// (manifest item with properties="nav"), then the spine chapter list.
// Returns [{ title, src, path }] with src as written in the book.
function parseTocXml(ncxXml) {
  const toc = [];
  const pointRe = /<navPoint[\s\S]*?<\/navPoint>/gi;
  let pm;
  // navPoint elements nest; a flat scan of navLabel+content pairs in
  // document order is the reading order for ordinary books.
  const labelRe = /<navLabel>[\s\S]*?<text>([\s\S]*?)<\/text>/gi;
  const contentRe = /<content[^>]*src=["']([^"']+)["']/gi;
  const labels = [...(ncxXml || '').matchAll(labelRe)].map((m) => unescapeXml(m[1].replace(/<[^>]+>/g, '').trim()));
  const srcs = [...(ncxXml || '').matchAll(contentRe)].map((m) => unescapeXml(m[1]));
  const n = Math.min(labels.length, srcs.length);
  for (let i = 0; i < n; i += 1) toc.push({ title: labels[i], src: srcs[i] });
  void pointRe;
  void pm;
  return toc;
}

function parseNavDocHtml(navHtml) {
  const toc = [];
  const aRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(navHtml)) !== null) {
    const title = unescapeXml(m[2].replace(/<[^>]+>/g, '').trim());
    if (title) toc.push({ title, src: unescapeXml(m[1]) });
  }
  return toc;
}

function resolveBookPath(opfDir, href) {
  const clean = String(href || '').split('#')[0];
  return opfDir ? opfDir + '/' + clean : clean;
}

// Render XHTML as plain text: block elements become line breaks, tags stripped.
function xhtmlToText(xhtml) {
  let s = String(xhtml || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<\/?(p|div|h[1-6]|li|tr|section|article|blockquote|br)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = unescapeXml(s);
  s = s.replace(/&nbsp;/gi, ' ');
  const lines = s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l) => l !== '');
  return lines.join('\n');
}

function parseEpub(buffer) {
  const entries = zipCore.listZip(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const containerEntry = byName.get('META-INF/container.xml');
  if (!containerEntry) throw new Error('Not an EPUB: META-INF/container.xml is missing.');
  const containerXml = zipCore.readEntry(buffer, containerEntry).toString('utf8');
  const opfPath = parseContainerXml(containerXml);
  const opfEntry = byName.get(opfPath);
  if (!opfEntry) throw new Error('EPUB is missing its content.opf: ' + opfPath);
  const opfXml = zipCore.readEntry(buffer, opfEntry).toString('utf8');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const meta = parseOpf(opfXml, opfDir);
  const encrypted = byName.has('META-INF/encryption.xml');
  const chapters = meta.chapters.map((ch) => {
    const entry = byName.get(ch.path) || byName.get(ch.href);
    let text = '';
    let error = null;
    if (!entry) error = 'Chapter file missing from the EPUB: ' + ch.path;
    else {
      try { text = xhtmlToText(zipCore.readEntry(buffer, entry).toString('utf8')); }
      catch (err) { error = err.message; }
    }
    const firstLine = text ? text.split('\n')[0].slice(0, 80) : '';
    return { ...ch, text, error, title: firstLine || ch.path };
  });
  // Table of contents.
  let toc = [];
  const ncxItem = meta.spineToc ? meta.manifest.get(meta.spineToc) : null;
  const ncxFromType = [...meta.manifest.values()].find((it) => it.mediaType === 'application/x-dtbncx+xml');
  const ncx = ncxItem || ncxFromType;
  if (ncx) {
    const ncxPath = resolveBookPath(opfDir, ncx.href);
    const ncxEntry = byName.get(ncxPath) || byName.get(ncx.href);
    if (ncxEntry) {
      try {
        toc = parseTocXml(zipCore.readEntry(buffer, ncxEntry).toString('utf8'))
          .map((t) => ({ ...t, path: resolveBookPath(opfDir, t.src) }));
      } catch { toc = []; }
    }
  }
  if (toc.length === 0) {
    const navItem = [...meta.manifest.values()].find((it) => (it.properties || '').split(/\s+/).includes('nav'));
    if (navItem) {
      const navPath = resolveBookPath(opfDir, navItem.href);
      const navEntry = byName.get(navPath) || byName.get(navItem.href);
      if (navEntry) {
        try {
          toc = parseNavDocHtml(zipCore.readEntry(buffer, navEntry).toString('utf8'))
            .map((t) => ({ ...t, path: resolveBookPath(opfDir, t.src) }));
        } catch { toc = []; }
      }
    }
  }
  if (toc.length === 0) toc = chapters.map((ch) => ({ title: ch.title, src: ch.href, path: ch.path }));
  return { title: meta.title, creator: meta.creator, language: meta.language, chapters, toc, encrypted };
}

module.exports = { unescapeXml, parseContainerXml, parseOpf, xhtmlToText, parseEpub, parseTocXml, parseNavDocHtml };
