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

  it('finds the job title and company under their other common column names', () => {
    const csv = ['Full Name,Current Job Title,Current Company,Email', 'Asha Rao,Head of Growth,Orbit Labs,asha@orbit.test'].join('\n');
    const lead = parseLeadsCsv(csv).leads[0];
    assert.equal(lead?.jobTitle, 'Head of Growth');
    assert.equal(lead?.company, 'Orbit Labs');
  });
  it('reads the column names used in the Scale spreadsheet', () => {
    const csv = [
      'First Name,Last Name,Current Job,Work Email,Mobile Phone,Linkedin URL Public,Company Name,Company Domain',
      'Saju,Mathew,Manager Sales,saju@cyberoam.test,+91 98331 90194,https://linkedin.com/in/saju,Cyberoam,cyberoam.com',
    ].join('\n');
    const lead = parseLeadsCsv(csv).leads[0];
    assert.equal(lead?.name, 'Saju Mathew');
    assert.equal(lead?.jobTitle, 'Manager Sales');
    assert.equal(lead?.company, 'Cyberoam');
    assert.ok(lead?.phone);
    assert.deepEqual(lead?.emails, ['saju@cyberoam.test']);
  });
});
