import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseLeadsCsv } from '../src/importer.js';
import { xlsxToCsv } from '../src/xlsx.js';

describe('xlsx import', () => {
  const file = readFileSync(new URL('./fixtures/leads.xlsx', import.meta.url));

  it('turns the first sheet into CSV, keeping text exactly as typed', () => {
    const csv = xlsxToCsv(file).split('\n');
    assert.equal(csv[0], 'title,category,address,phone');
    assert.equal(csv[1], 'Xlsx Gems,Jewelry store,"Dadar, Mumbai & Co",+91 98200 77777');
    assert.equal(csv[2], 'Inline Gold,,"Dadar, Mumbai & Co",9820088888');
  });

  it('feeds the same importer as a CSV file does', () => {
    const parsed = parseLeadsCsv(xlsxToCsv(file));
    assert.equal(parsed.leads.length, 2);
    assert.equal(parsed.leads[0]?.name, 'Xlsx Gems');
  });

  it('rejects a file that is not a workbook', () => {
    assert.throws(() => xlsxToCsv(Buffer.from('just,some,csv\n1,2,3')), /xlsx/i);
  });
});
