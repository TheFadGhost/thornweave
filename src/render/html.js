/**
 * @file Renderers: IR blocks -> HTML (player/export) and -> plain text
 * (transcripts). All story content is HTML-escaped here (SPEC §11).
 */

export function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render display blocks to HTML. `linkHref(choiceIndex)` supplies the href. */
export function blocksToHtml(blocks, linkHref) {
  const out = [];
  for (const b of blocks) {
    if (b.type === 'break') {
      out.push('<hr class="scene-break" aria-hidden="true">');
      continue;
    }
    out.push(`<p>${runsToHtml(b.runs, linkHref)}</p>`);
  }
  return out.join('\n');
}

function runsToHtml(runs, linkHref) {
  let s = '';
  for (const r of runs) {
    if (r.t === 'text') s += escapeHtml(r.v);
    else if (r.t === 'em') s += `<em>${runsToHtml(r.runs, linkHref)}</em>`;
    else if (r.t === 'strong') s += `<strong>${runsToHtml(r.runs, linkHref)}</strong>`;
    else if (r.t === 'link') s += `<a class="inline-link" data-choice="${r.choice}" href="${escapeHtml(linkHref(r.choice))}">${escapeHtml(r.label ?? '\u2192')}</a>`;
  }
  return s;
}

export function runsToText(runs) {
  return runs.map((r) => (r.t === 'text' ? r.v : r.t === 'link' ? (r.label ?? '') : r.t === 'em' || r.t === 'strong' ? runsToText(r.runs) : '')).join('');
}

export function blocksToText(blocks) {
  const parts = [];
  for (const b of blocks) {
    if (b.type === 'break') { parts.push('· · ·'); continue; }
    parts.push(runsToText(b.runs));
  }
  return parts.join('\n\n');
}
