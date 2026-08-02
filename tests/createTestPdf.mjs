import { writeFile } from 'node:fs/promises';

const outputPath = process.argv[2] || '/tmp/band-score-viewer-test.pdf';

function streamObject(content) {
  return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
}

const pageOneContent = [
  '0 0 0 RG 2 w',
  '40 440 320 80 re S',
  '40 300 150 80 re S',
  '210 300 150 80 re S',
  'BT /F1 20 Tf 48 550 Td (Band Score Viewer - Page 1) Tj ET',
].join('\n');
const pageTwoContent = [
  '0 0 0 RG 2 w',
  '50 530 400 90 re S',
  '50 370 190 90 re S',
  '260 370 190 90 re S',
  'BT /F1 20 Tf 58 650 Td (Band Score Viewer - Page 2) Tj ET',
].join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  streamObject(pageOneContent),
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 700] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  streamObject(pageTwoContent),
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];

let pdf = '%PDF-1.4\n';
const offsets = [0];

objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf, 'ascii'));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});

const xrefOffset = Buffer.byteLength(pdf, 'ascii');

pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
pdf += offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
  .join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

await writeFile(outputPath, pdf, 'ascii');
console.log(outputPath);
