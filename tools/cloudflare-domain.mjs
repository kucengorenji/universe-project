import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const account = '739f03f83468d34f88ddf80477cb25b9';
const project = 'aethergate-globe', domain = 'aethergate.cloud';
const mode = process.argv[2] || 'status';
if (!['status', 'attach', 'dns'].includes(mode)) throw Error('Use status, attach or dns');
let token;
try {
  // Wrangler manages its existing login; credentials stay in memory and are sent only to Cloudflare.
  const { stdout } = await run('npx', ['--yes', 'wrangler', 'auth', 'token', '--json'], { maxBuffer: 1024 * 1024 });
  const auth = JSON.parse(stdout);
  token = auth.token;
  if (!token) throw Error('Authentication unavailable');
  async function api(resource, method = 'GET', body) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/${resource}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw Error(`Cloudflare ${response.status}: ${JSON.stringify(data.errors)}`);
    return data.result;
  }
  const zones = await api(`zones?name=${domain}`);
  const zone = zones.find(z => z.account.id === account);
  if (!zone) throw Error('Domain is not in the target account');
  console.log(JSON.stringify({ zone: zone.name, status: zone.status, nameservers: zone.name_servers }));
  try {
    const records = await api(`zones/${zone.id}/dns_records?name=${domain}`);
    console.log(JSON.stringify({ apexDns: records.map(r => ({ type: r.type, name: r.name, content: r.content, proxied: r.proxied })) }));
  } catch { console.log(JSON.stringify({ apexDns: 'DNS read permission unavailable for this OAuth scope' })); }
  const resource = `accounts/${account}/pages/projects/${project}/domains`;
  let domains = await api(resource);
  if (mode === 'attach' && !domains.some(d => d.name === domain)) {
    const attached = await api(resource, 'POST', { name: domain });
    domains = [attached];
  }
  if (mode === 'dns') {
    if (!domains.some(d => d.name === domain)) throw Error('Attach the Pages domain before creating DNS');
    // Create only: Cloudflare rejects conflicting records. Never replace or delete existing DNS.
    const record = await api(`zones/${zone.id}/dns_records`, 'POST', {
      type: 'CNAME', name: domain, content: `${project}.pages.dev`, proxied: true, ttl: 1
    });
    console.log(JSON.stringify({ createdDns: { type: record.type, name: record.name, content: record.content, proxied: record.proxied } }));
  }
  console.log(JSON.stringify({ project, domains: domains.map(d => ({ name: d.name, status: d.status, validation: d.validation_data, verification: d.verification_data })) }, null, 2));
} catch (error) {
  const message = error.message.startsWith('Cloudflare ') || error.message === 'Domain is not in the target account' ? error.message : 'Cloudflare authentication/API operation unavailable';
  console.error(token ? message.replaceAll(token, '[redacted]') : message);
  process.exitCode = 1;
}
