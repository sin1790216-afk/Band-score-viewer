import { writeFile } from 'node:fs/promises';

const outputPath = process.argv[2] || '/tmp/band-score-viewer-recognition-test.pdf';

function streamObject(content) {
  return `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}\nendstream`;
}

function createStaffCommands(bottom) {
  const commands = [];
  const left = 60;
  const right = 540;
  const spacing = 10;

  for (let line = 0; line < 5; line += 1) {
    const y = bottom + line * spacing;

    commands.push(`${left} ${y} m ${right} ${y} l S`);
  }

  [60, 180, 330, 450, 540].forEach((x) => {
    commands.push(`${x} ${bottom} m ${x} ${bottom + spacing * 4} l S`);
  });

  // 마디선과 달리 오선 전체를 관통하지 않는 합성 음표 기둥이다.
  commands.push(`${left + 70} ${bottom + spacing} m ${left + 70} ${bottom + spacing * 3} l S`);

  return commands;
}

const pageContent = [
  '0 0 0 RG 1 w',
  ...createStaffCommands(560),
  ...createStaffCommands(350),
  ...createStaffCommands(140),
].join('\n');
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R >>',
  streamObject(pageContent),
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
