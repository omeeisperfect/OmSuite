// OmSuite Windows — small, safe Markdown preview renderer.
// Deliberately a subset, documented as such: headings, bold, italic, inline
// code, fenced code blocks, links, lists, blockquotes, rules, paragraphs.
// SECURITY: all user text is HTML-escaped FIRST; raw HTML in the document is
// never passed through, so a Markdown file cannot inject scripts or markup
// into the preview. Link targets are restricted to http/https/mailto and
// relative paths; javascript:/data: targets are replaced with "#".
// Works both as a browser script (window.OMMarkdown) and under Node (require).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OMMarkdown = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeHref(href) {
    const h = String(href || '').trim();
    if (/^(https?:|mailto:)/i.test(h)) return escapeHtml(h);
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return '#'; // javascript:, data:, etc. blocked
    if (h.startsWith('/') || h.startsWith('./') || h.startsWith('../') || h.startsWith('#')) return escapeHtml(h);
    return escapeHtml(h); // plain relative file name
  }

  function inline(s) {
    // Code spans first so their contents are never parsed as emphasis/links.
    const codeSpans = [];
    let out = escapeHtml(s).replace(/`([^`]+)`/g, function (_m, code) {
      codeSpans.push(code);
      return '\u0000' + (codeSpans.length - 1) + '\u0000';
    });
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_m, text, href) {
      return '<a href="' + safeHref(href) + '">' + text + '</a>';
    });
    out = out.replace(/\u0000(\d+)\u0000/g, function (_m, i) {
      return '<code>' + codeSpans[Number(i)] + '</code>';
    });
    return out;
  }

  function renderMarkdown(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let i = 0;
    let inFence = false;
    let fenceBuf = [];
    let listTag = null;

    function closeList() {
      if (listTag) { html += '</' + listTag + '>'; listTag = null; }
    }

    while (i < lines.length) {
      const line = lines[i];
      if (inFence) {
        if (/^```/.test(line)) {
          html += '<pre><code>' + escapeHtml(fenceBuf.join('\n')) + '</code></pre>';
          fenceBuf = [];
          inFence = false;
        } else {
          fenceBuf.push(line);
        }
        i += 1;
        continue;
      }
      if (/^```/.test(line)) { closeList(); inFence = true; fenceBuf = []; i += 1; continue; }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        html += '<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>';
        i += 1; continue;
      }
      if (/^\s*---+\s*$/.test(line)) { closeList(); html += '<hr>'; i += 1; continue; }
      const quote = line.match(/^>\s?(.*)$/);
      if (quote) { closeList(); html += '<blockquote>' + inline(quote[1]) + '</blockquote>'; i += 1; continue; }
      const ul = line.match(/^\s*[-*]\s+(.*)$/);
      const ol = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ul || ol) {
        const tag = ul ? 'ul' : 'ol';
        const body = (ul || ol)[1];
        if (listTag !== tag) { closeList(); html += '<' + tag + '>'; listTag = tag; }
        html += '<li>' + inline(body) + '</li>';
        i += 1; continue;
      }
      closeList();
      if (line.trim() === '') { i += 1; continue; }
      html += '<p>' + inline(line) + '</p>';
      i += 1;
    }
    if (inFence) html += '<pre><code>' + escapeHtml(fenceBuf.join('\n')) + '</code></pre>';
    closeList();
    return html;
  }

  return { renderMarkdown, escapeHtml, safeHref };
});
