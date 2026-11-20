import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';
import type { Role } from './auth.js';
import { loadConfig } from './config.js';
import type { Category, Db } from './db.js';
import { insertMany, newId, one, openDb, run, tx } from './db.js';
import { ICON_COLOR, LEAD_COLUMNS, leadValues, slugify } from './domain.js';
import type { WorkspaceIcon } from './domain.js';
import { parseLeadsCsv } from './importer.js';

interface SeedUser {
  name: string;
  email: string;
  role: Role;
  category: Category | null;
  workspaces: string[];
}

const WORKSPACES: { category: Category; name: string; icon: WorkspaceIcon }[] = [
  { category: 'scale', name: 'Website', icon: 'globe' },
  { category: 'scale', name: 'SEO', icon: 'seo' },
  { category: 'scale', name: 'Social Media', icon: 'chat' },
  { category: 'scale', name: 'iDraft', icon: 'gem' },
  { category: 'reach', name: 'Website', icon: 'globe' },
  { category: 'reach', name: 'SEO', icon: 'seo' },
  { category: 'reach', name: 'Social Media', icon: 'chat' },
];

const USERS: SeedUser[] = [
  { name: 'Aarav Kapoor', email: 'aarav@fynix.test', role: 'superadmin', category: null, workspaces: [] },
  { name: 'Meera Nair', email: 'meera@fynix.test', role: 'superadmin', category: null, workspaces: [] },
  { name: 'Nisha Verma', email: 'nisha@fynix.test', role: 'manager', category: null, workspaces: [] },
  { name: 'Priya Sharma', email: 'priya@fynix.test', role: 'sales', category: 'scale', workspaces: ['scale-website', 'scale-seo'] },
  { name: 'Rohan Mehta', email: 'rohan@fynix.test', role: 'sales', category: 'scale', workspaces: ['scale-website', 'scale-social-media', 'scale-idraft'] },
  { name: 'Aisha Khan', email: 'aisha@fynix.test', role: 'sales', category: 'reach', workspaces: ['reach-social-media', 'reach-website'] },
  { name: 'Karan Joshi', email: 'karan@fynix.test', role: 'sales', category: 'reach', workspaces: ['reach-website', 'reach-seo'] },
];

const REACH_KINDS = ['Dental clinic', 'Restaurant', 'Salon', 'Gym', 'Tuition centre', 'Bakery', 'Pharmacy', 'Furniture shop'];
const REACH_AREAS = ['Kothrud', 'Baner', 'Aundh', 'Viman Nagar', 'Hadapsar', 'Wakad'];

/** Clearly labelled sample rows so the Reach category has something to work with in development. */
export function sampleReachCsv(count = 60): string {
  const lines = ['title,category,address,phone,website,place_id,social_links'];
  for (let i = 1; i <= count; i += 1) {
    const kind = REACH_KINDS[i % REACH_KINDS.length] ?? 'Shop';
    const area = REACH_AREAS[i % REACH_AREAS.length] ?? 'Pune';
    const phone = `98${String(10_000_000 + i * 7919).slice(0, 8)}`;
    const social = i % 3 === 0 ? `"https://instagram.com/sample_${i} https://facebook.com/sample.${i}"` : '';
    lines.push(`Sample ${kind} ${String(i).padStart(2, '0')},${kind},"${area}, Pune",${phone},,sample-reach-${i},${social}`);
  }
  return lines.join('\n');
}

/** Sample B2B leads matching the Scale schema format (Full Name, Company, Job Title, Personal Number, Keywords, etc.). */
export function sampleScaleCsv(): string {
  const lines = [
    'Linkedin Url,Full Name,First Name,Last Name,Email,Personal Number,Job Title,Company,Company Website,City,State,Country,Industry,Keywords,Employees,Company Linkedin,Twitter Url,Facebook',
    'https://www.linkedin.com/in/karun-paruthi,Karun Paruthi,Karun,Paruthi,kp@weroute.ai,+91 98201 12345,Co-Founder,WeRoute Solutions,http://www.weroute.ai,Bengaluru,Karnataka,India,information technology and services,"manpower, recruitment, staffing, tech talent",23,https://www.linkedin.com/company/weroute-solutions,,',
    'https://www.linkedin.com/in/rohit-singhania,Rohit Singhania,Rohit,Singhania,rohit@finlytics.io,+91 98334 56789,VP of Engineering,FinLytics Platform,https://finlytics.io,Mumbai,Maharashtra,India,financial services,"fintech, analytics, b2b saas, ai banking",65,https://www.linkedin.com/company/finlytics,,',
    'https://www.linkedin.com/in/ananya-deshmukh,Ananya Deshmukh,Ananya,Deshmukh,ananya@apexcloud.dev,+91 98450 98765,Chief Technology Officer,Apex Cloud Systems,https://apexcloud.dev,Pune,Maharashtra,India,cloud services,"devops, kubernetes, aws, infrastructure",40,https://www.linkedin.com/company/apexcloud,,',
    'https://www.linkedin.com/in/vikram-nambiar,Vikram Nambiar,Vikram,Nambiar,vikram@healthbridge.in,+91 99001 23456,Founder & CEO,HealthBridge Solutions,https://healthbridge.in,Bengaluru,Karnataka,India,hospital & health care,"healthtech, ehr, telemedicine, ai diagnostics",52,https://www.linkedin.com/company/healthbridge,,',
    'https://www.linkedin.com/in/meera-krishnan,Meera Krishnan,Meera,Krishnan,meera@zenithai.com,+91 98112 87654,Head of Product,Zenith AI Labs,https://zenithai.com,Gurugram,Haryana,India,artificial intelligence,"generative ai, llm, prompt engineering",30,https://www.linkedin.com/company/zenithai,,',
    'https://www.linkedin.com/in/aditya-verma,Aditya Verma,Aditya,Verma,aditya@scaleops.co,+91 98765 43219,Director of Operations,ScaleOps Logistics,https://scaleops.co,Hyderabad,Telangana,India,logistics & supply chain,"supply chain, freight, fleet tracking",110,https://www.linkedin.com/company/scaleops,,',
    'https://www.linkedin.com/in/sneha-kulkarni,Sneha Kulkarni,Sneha,Kulkarni,sneha@pulsemedia.in,+91 98220 34567,Managing Director,Pulse Digital Media,https://pulsemedia.in,Mumbai,Maharashtra,India,marketing & advertising,"performance marketing, growth, b2b branding",25,https://www.linkedin.com/company/pulsemedia,,',
    'https://www.linkedin.com/in/karan-malhotra,Karan Malhotra,Karan,Malhotra,karan@cyberguard.tech,+91 98199 87650,VP of Cybersecurity,CyberGuard Solutions,https://cyberguard.tech,Bengaluru,Karnataka,India,computer & network security,"cybersecurity, soc, pen testing, zero trust",48,https://www.linkedin.com/company/cyberguard,,',
    'https://www.linkedin.com/in/tanvi-patel,Tanvi Patel,Tanvi,Patel,tanvi@greengrid.org,+91 98250 67891,Head of Sustainability,GreenGrid Energy,https://greengrid.org,Ahmedabad,Gujarat,India,renewables & environment,"clean energy, solar iot, smart grid",75,https://www.linkedin.com/company/greengrid,,',
    'https://www.linkedin.com/in/siddharth-joshi,Siddharth Joshi,Siddharth,Joshi,siddharth@eduspark.io,+91 98205 11223,Co-Founder & COO,EduSpark Learning,https://eduspark.io,Pune,Maharashtra,India,e-learning,"edtech, skill development, corporate training",38,https://www.linkedin.com/company/eduspark,,',
    'https://www.linkedin.com/in/priya-ramesh,Priya Ramesh,Priya,Ramesh,priya.r@nexuscrm.ai,+91 98401 55667,Head of Customer Success,Nexus CRM,https://nexuscrm.ai,Chennai,Tamil Nadu,India,b2b saas,"crm, customer success, retention",32,https://www.linkedin.com/company/nexuscrm,,',
    'https://www.linkedin.com/in/harsh-vardhan,Harsh Vardhan,Harsh,Vardhan,harsh@autoflow.io,+91 98188 99001,Chief Executive Officer,AutoFlow Robotics,https://autoflow.io,Noida,Uttar Pradesh,India,robotics & automation,"industrial automation, ai vision, robotics",55,https://www.linkedin.com/company/autoflow,,',
  ];
  return lines.join('\n');
}

async function addList(db: Db, category: Category, name: string, fileName: string, csv: string, workspaceIds: string[]): Promise<number> {
  const { leads } = parseLeadsCsv(csv);
  const listId = newId();
  await run(db, 'INSERT INTO lists (id, name, category, file_name, created_by, created_at) VALUES (?, ?, ?, ?, NULL, ?)', [listId, name, category, fileName, Date.now()]);
  await insertMany(db, 'leads', LEAD_COLUMNS, leads.map((lead) => leadValues(newId(), listId, lead)));
  for (const workspaceId of workspaceIds) await run(db, 'INSERT INTO workspace_lists (workspace_id, list_id) VALUES (?, ?)', [workspaceId, listId]);
  return leads.length;
}

export async function seedDatabase(db: Db, password: string, options: { jewelleryCsv?: string; scaleCsv?: string } = {}): Promise<string> {
  if (await one(db, 'SELECT 1 AS x FROM users LIMIT 1')) return 'Database already has accounts. Nothing was changed.';
  const passwordHash = await hashPassword(password);
  const scaleCsv =
    options.scaleCsv ??
    (options.jewelleryCsv ??
      (fs.existsSync(path.resolve(import.meta.dirname, '..', 'seed', 'sample_scale.csv'))
        ? fs.readFileSync(path.resolve(import.meta.dirname, '..', 'seed', 'sample_scale.csv'), 'utf8')
        : sampleScaleCsv()));
  const scaleName = options.jewelleryCsv ? 'Jewellery stores, Mumbai' : 'B2B Leaders & Executives';
  const scaleFile = options.jewelleryCsv ? 'jewellery_v2.csv' : 'sample_scale.csv';

  return tx(db, async (db) => {
    const position: Record<string, number> = {};
    for (const ws of WORKSPACES) {
      const key = slugify(ws.name);
      position[ws.category] = (position[ws.category] ?? -1) + 1;
      await run(db, 'INSERT INTO workspaces (id, category, key, name, icon, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        `${ws.category}-${key}`, ws.category, key, ws.name, ws.icon, ICON_COLOR[ws.icon], position[ws.category] ?? 0, Date.now(),
      ]);
    }
    for (const user of USERS) {
      const id = newId();
      await run(db, 'INSERT INTO users (id, name, email, password_hash, role, category, active, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)', [
        id, user.name, user.email, passwordHash, user.role, user.category, Date.now(),
      ]);
      for (const workspaceId of user.workspaces) await run(db, 'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)', [workspaceId, id]);
    }
    const scaleWorkspaces = WORKSPACES.filter((w) => w.category === 'scale').map((w) => `scale-${slugify(w.name)}`);
    const reachWorkspaces = WORKSPACES.filter((w) => w.category === 'reach').map((w) => `reach-${slugify(w.name)}`);
    const scaleCount = await addList(db, 'scale', scaleName, scaleFile, scaleCsv, scaleWorkspaces);
    const reachCount = await addList(db, 'reach', 'Local businesses, Pune (sample)', 'sample_reach.csv', sampleReachCsv(), reachWorkspaces);
    return `Seeded ${USERS.length} accounts, ${WORKSPACES.length} workspaces, ${scaleCount} Scale leads and ${reachCount} Reach leads.`;
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const password = process.env['SEED_PASSWORD'];
  if (!password || password.length < 10) {
    throw new Error('Set SEED_PASSWORD (at least 10 characters) in .env before seeding. See .env.example.');
  }
  const db = await openDb(config.databaseUrl);
  console.log(await seedDatabase(db, password));
  await db.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
