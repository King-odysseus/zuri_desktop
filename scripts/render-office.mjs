#!/usr/bin/env node
/**
 * Build one sample of each Office file Zuri makes and turn each into a PDF, so the
 * result can be looked at instead of only unzipped.
 *
 * Why this exists: the selftests prove a file has the right parts, not that it looks
 * right. Spacing, colour and text that spills off a slide show up only when a page is
 * drawn. LibreOffice does the drawing, headless, so it needs no Office licence.
 *
 * Usage: npm run office:render [outputFolder]
 * The default folder is .kai/tmp/render, which git ignores. Nothing here changes the app.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(process.argv[2] ?? path.join(root, '.kai', 'tmp', 'render'));

const CANDIDATES = [
  process.env.SOFFICE_PATH,
  'soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
].filter(Boolean);

/** The first LibreOffice command that answers --version, or null when none is installed. */
function findLibreOffice() {
  for (const command of CANDIDATES) {
    const probe = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 30_000 });
    if (probe.status === 0) return command;
  }
  return null;
}

const SAMPLES = {
  docx: {
    title: 'Quarterly review', subtitle: 'Operations, Q3', author: 'Zuri', date: '2 Nov 2026', theme: 'zuri', coverPage: true, toc: true,
    sections: [
      { heading: 'Summary', paragraphs: ['Revenue grew **12%** against the second quarter, led by new clients in *Lagos* and Nairobi.'], callout: 'Decision needed: approve the Q4 budget by 15 November.', bullets: ['Costs held flat', { text: 'Rent unchanged', level: 1 }, 'Two new hires'] },
      { blocks: [{ type: 'heading', text: 'Numbers', level: 1 }, { type: 'table', caption: 'Table 1: Spend by area', rows: [['Area', 'Plan', 'Actual'], ['Rent', '1,200', '1,200'], ['Power', '300', '245'], ['Staff', '4,000', '4,150']] }, { type: 'numbered', items: ['Review the plan', 'Confirm the hires', 'Sign off'] }, { type: 'quote', text: 'Make it simple, then make it better.' }] },
    ],
  },
  xlsx: {
    dashboard: true,
    sheets: [{
      name: 'Dashboard', title: 'Sales and profit dashboard', subtitle: 'January to December 2026', tableTitle: 'Performance by category',
      kpis: [
        { label: 'Total sales', value: 1248320, change: '+18.6% vs last year', format: '$#,##0' },
        { label: 'Total profit', value: 312540, change: '+22.4% vs last year', format: '$#,##0' },
        { label: 'Profit margin', value: 0.2503, change: '+3.1 pts', format: '0.0%' },
        { label: 'Total orders', value: 4782, change: '+15.2% vs last year', format: '#,##0' },
      ],
      columns: ['Category', { header: 'Sales', type: 'currency' }, { header: 'Profit', type: 'currency' }, { header: 'Margin', type: 'percent' }, { header: 'Orders', type: 'integer' }],
      rows: [['Electronics', 370450, 112320, 0.3032, 1284], ['Furniture', 298160, 78950, 0.2648, 1102], ['Clothing', 254320, 66180, 0.2602, 956], ['Office supplies', 182540, 38960, 0.2134, 741], ['Other', 142850, 16130, 0.1129, 699]],
      totals: true, scale: ['Sales'], highlight: [{ column: 'Profit', rule: 'negative', color: 'blue' }],
      charts: [
        { type: 'bar', title: 'Sales and profit by category', categories: 'Category', values: ['Sales', 'Profit'] },
        { type: 'line', title: 'Orders by category', categories: 'Category', values: ['Orders'] },
        { type: 'pie', title: 'Sales mix', categories: 'Category', values: ['Sales'] },
      ],
    }, {
      name: 'Monthly data', columns: ['Month', { header: 'Sales', type: 'currency' }, { header: 'Profit', type: 'currency' }, { header: 'Orders', type: 'integer' }],
      rows: [['Jan', 78000, 18000, 340], ['Feb', 92000, 21000, 378], ['Mar', 108000, 26000, 401], ['Apr', 115000, 29000, 422], ['May', 112000, 28000, 418], ['Jun', 126000, 34000, 455]],
      totals: true,
    }],
  },
  pptx: {
    title: 'Q3 in numbers', subtitle: 'Operations review', author: 'Zuri', date: '2 Nov 2026',
    slides: [
      { title: 'Revenue grew 12% in Q3', layout: 'bigNumber', stat: '+12%', caption: 'against Q2' },
      { title: 'How we work', steps: [{ title: 'Plan', text: 'Set the target' }, { title: 'Build', text: 'Make the thing' }, { title: 'Ship', text: 'Release and learn' }] },
      { title: 'Spend by area', chart: { type: 'bar', labels: ['Rent', 'Power', 'Staff'], series: [{ name: 'Plan', values: [1200, 300, 4000] }, { name: 'Actual', values: [1200, 245, 4150] }] } },
      { title: 'Before and after', left: { heading: 'Before', bullets: ['Manual reports', 'Late numbers'] }, right: { heading: 'After', bullets: ['One dashboard', 'Daily numbers'] } },
      { title: 'What we will do next quarter to keep growing without adding cost', bullets: ['Keep costs flat while volume grows by a tenth', 'Hire two people into the support team', 'Move reports to one shared dashboard', 'Review suppliers every month', 'Test one new city', 'Cut manual steps in billing', 'Start weekly customer calls'] },
      { title: 'Thank you', layout: 'closing' },
    ],
  },
};

const soffice = findLibreOffice();
fs.mkdirSync(outputDirectory, { recursive: true });

const { buildOfficeFile } = await import(pathToFileURL(path.join(root, 'src', 'main', 'office.js')).href);
const written = [];
for (const [kind, content] of Object.entries(SAMPLES)) {
  const file = path.join(outputDirectory, `sample.${kind}`);
  fs.writeFileSync(file, await buildOfficeFile(kind, content));
  written.push(file);
}
console.log(`Built ${written.length} sample files in ${outputDirectory}`);

if (!soffice) {
  console.log('LibreOffice was not found, so the pages were not drawn. Install it (winget install TheDocumentFoundation.LibreOffice), or set SOFFICE_PATH to soffice, then run this again.');
  process.exit(0);
}

let failed = 0;
for (const file of written) {
  const converted = spawnSync(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outputDirectory, file], { encoding: 'utf8', timeout: 180_000 });
  const pdf = file.replace(/\.[^.]+$/, '.pdf');
  if (converted.status === 0 && fs.existsSync(pdf)) {
    console.log(`Drew ${path.basename(pdf)}`);
  } else {
    failed += 1;
    console.error(`LibreOffice could not draw ${path.basename(file)}: ${(converted.stderr || converted.stdout || 'no output').trim().slice(0, 300)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
