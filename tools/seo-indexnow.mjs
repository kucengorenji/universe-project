// Tells IndexNow search engines (Bing, Yandex, Seznam, Naver; DuckDuckGo and Yahoo use Bing's index)
// that the public pages changed. Run it after a production deploy:
//
//   npm run seo:indexnow
//
// The key is public by design: public/<key>.txt must be live before this runs. Google does not use IndexNow;
// it reads public/sitemap.xml submitted once in Search Console.
import { readFileSync } from 'node:fs';

const host = 'aethergate.cloud';
const key = 'cf1af2916622e0a3ef2db2f2b359b869';
const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const live = await fetch(`https://${host}/${key}.txt`);
if (!live.ok || (await live.text()).trim() !== key) {
  throw Error(`Key file https://${host}/${key}.txt is not live yet; deploy first.`);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${key}.txt`, urlList }),
});
// 200 = accepted, 202 = accepted and the key is still being validated
console.log(`IndexNow ${res.status} for ${urlList.length} URLs: ${urlList.join(', ')}`);
if (res.status >= 300) process.exitCode = 1;
