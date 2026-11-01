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
    if (id && href) manifest.set(id[1], { href: unescapeXml(href[1]), mediaType: media ? media[1] : '' });
  }
  const spineRe = /<spine[^>]*>([\s\S]*?)<\/spine>/i.exec(opfXml);
  const spine = [];
  if (spineRe) {
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
  };
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
  const chapters = meta.chapters.map((ch) => {
    const entry = byName.get(ch.path) || byName.get(ch.href);
    let text = '';
    let error = null;
    if (!entry) error = 'Chapter file missing from the EPUB: ' + ch.path;
    else {
      try { text = xhtmlToText(zipCore.readEntry(buffer, entry).toString('utf8')); }
      catch (err) { error = err.message; }
    }
    return { ...ch, text, error };
  });
  return { title: meta.title, creator: meta.creator, language: meta.language, chapters };
}

module.exports = { unescapeXml, parseContainerXml, parseOpf, xhtmlToText, parseEpub };
