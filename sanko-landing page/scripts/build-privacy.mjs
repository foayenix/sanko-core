import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Builds public/privacy/ from PRIVACY.md, so the published notice cannot drift from
// the one in the repository. It had drifted: the page sat at version 1.0 while
// PRIVACY.md was at 1.1, which meant the notice a person actually read was a version
// behind the notice the project believed it was giving them. A privacy notice is the
// wrong document to keep two copies of by hand.
//
// This publishes PRIVACY.md in full rather than a summary of it, because PRIVACY.md
// names sanko.africa/privacy as the full policy. A shorter page at that URL makes
// that sentence false.
//
// Two things the generator does on the way out, both because the repository and the
// web are different audiences:
//
//   1. Relative links are de-linked. `governance/contributor-terms-v1.md` resolves in
//      a checkout and 404s on the website, and a privacy notice full of dead links
//      reads as neglected. The text survives; only the href goes. Absolute, mailto:
//      and in-page links pass through untouched.
//   2. A section can opt out with `<!-- web:skip -->` on the line after its heading.
//      Nothing uses it today. It exists so that the answer to "this paragraph is for
//      the repository, not the public" is a marker in the source rather than a second
//      copy of the document.
//
// Run with: npm run privacy:build

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(projectDirectory, '..');

const sourcePath = path.resolve(repositoryDirectory, 'PRIVACY.md');
const templatePath = path.resolve(projectDirectory, 'templates', 'privacy.html');
const outputPath = path.resolve(projectDirectory, 'public', 'privacy', 'index.html');

// ---------------------------------------------------------------- utilities

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let delinked = 0;

// Inline markdown, in the order that stops one rule eating another's output:
// code first (its contents are literal), then links, then bold.
const inline = (text) => {
  const codes = [];
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(escapeHtml(code));
    return `\u0001${codes.length - 1}\u0001`;
  });

  out = escapeHtml(out);

  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    const target = href.trim();
    const isPublic = /^(https?:|mailto:|#|\/)/i.test(target);
    if (!isPublic) {
      delinked += 1;
      return label; // repository path — keep the words, drop the dead link
    }
    return `<a href="${escapeHtml(target)}">${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // PRIVACY.md writes the contact address bare, and a privacy notice whose contact
  // address is not clickable is worse than one that is. The leading-character group
  // keeps this off addresses already inside a mailto: href, and the domain pattern
  // cannot end on a full stop, so sentence punctuation stays outside the link.
  out = out.replace(
    /(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g,
    (_, lead, address) => `${lead}<a href="mailto:${address}">${address}</a>`,
  );

  return out.replace(/\u0001(\d+)\u0001/g, (_, index) => `<code>${codes[Number(index)]}</code>`);
};

const isTableRow = (line) => line.trim().startsWith('|');
const isTableDivider = (line) => /^\s*\|[\s|:-]+\|\s*$/.test(line);
const cells = (line) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

// ---------------------------------------------------------------- block rendering

const renderBlocks = (lines) => {
  const html = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim() || line.trim() === '---') {
      index += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      html.push(`<h3>${inline(line.slice(4).trim())}</h3>`);
      index += 1;
      continue;
    }

    if (isTableRow(line) && isTableDivider(lines[index + 1] ?? '')) {
      const head = cells(line).map((cell) => `<th>${inline(cell)}</th>`).join('');
      index += 2;
      const body = [];
      while (index < lines.length && isTableRow(lines[index])) {
        body.push(`<tr>${cells(lines[index]).map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`);
        index += 1;
      }
      html.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${body.join('')}</tbody></table>`,
      );
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && (/^\s*[-*]\s+/.test(lines[index]) || (items.length && /^\s{2,}\S/.test(lines[index])))) {
        if (/^\s*[-*]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s*[-*]\s+/, '').trim());
        } else {
          // continuation of the previous bullet, wrapped in the source
          items[items.length - 1] += ` ${lines[index].trim()}`;
        }
        index += 1;
      }
      html.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      lines[index].trim() !== '---' &&
      !lines[index].startsWith('#') &&
      !isTableRow(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length) html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return html.join('');
};

// ---------------------------------------------------------------- build

const markdown = await readFile(sourcePath, 'utf8');
const template = await readFile(templatePath, 'utf8');
const lines = markdown.split('\n');

const titleLine = lines.find((line) => line.startsWith('# ')) ?? '# Privacy notice';
const title = titleLine.slice(2).trim();

// The bold line under the title, e.g. "**Version 1.2 · September 2026 · ...**"
const versionLine = lines.find((line) => /^\*\*Version/.test(line.trim()));
const version = versionLine ? versionLine.trim().replace(/^\*\*|\*\*$/g, '') : '';

// Split on "## " headings; anything before the first one is front matter already
// rendered into the page header above.
const sections = [];
let current = null;
for (const line of lines) {
  if (line.startsWith('## ')) {
    if (current) sections.push(current);
    current = { heading: line.slice(3).trim(), body: [] };
  } else if (current) {
    current.body.push(line);
  }
}
if (current) sections.push(current);

let skipped = 0;
const rendered = sections
  .filter((section) => {
    const optedOut = section.body.some(
      (line, i) => i < 3 && line.trim() === '<!-- web:skip -->',
    );
    if (optedOut) skipped += 1;
    return !optedOut;
  })
  .map((section) => {
    const body = renderBlocks(section.body.filter((line) => !line.trim().startsWith('<!--')));
    return `    <section class="notice"><h2>${inline(section.heading)}</h2><div>${body}</div></section>`;
  })
  .join('\n');

const description =
  'Privacy and security notice for Sanko — what is collected, who can see it, how long it is kept.';

const html = template
  .replace(/\{\{TITLE\}\}/g, escapeHtml(title))
  .replace(/\{\{DESCRIPTION\}\}/g, escapeHtml(description))
  .replace('{{HEADING}}', 'Privacy &amp; security notice.')
  .replace('{{VERSION}}', escapeHtml(version))
  .replace('{{CONTENT}}', rendered);

await writeFile(outputPath, html, 'utf8');

console.log(
  `Privacy page built: ${sections.length - skipped} sections from ${path.relative(repositoryDirectory, sourcePath)}.`,
);
if (skipped) console.log(`  ${skipped} section(s) held back by <!-- web:skip -->.`);
if (delinked) console.log(`  ${delinked} repository link(s) rendered as plain text.`);
console.log(`  ${version}`);
console.log(`Written to ${path.relative(repositoryDirectory, outputPath)}.`);
