// Проверки интерфейса: нужен запущенный HTTP-сервер и Playwright (см. README).
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const browser=await chromium.launch({ ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}), args:['--no-sandbox'] });
const base=(process.argv[2] || 'http://127.0.0.1:8000/christian-monotheism/').replace(/\/?$/, '/');
const docs=JSON.parse(await fs.readFile(fileURLToPath(new URL('../assets/search-index.json',import.meta.url)),'utf8')).docs.filter(d=>d.type==='article');
const total=docs.length;
const inTopic=id=>docs.filter(d=>d.topics.includes(id)).length;
const errors=[];let checks=0;
const ok=(value,message)=>{assert(value,message);checks++;};
try {
const p=await browser.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>errors.push(e.message));
const go=async route=>{await p.goto(base+route,{waitUntil:'networkidle'});};
const visible=()=>p.locator('[data-catalog-list] > li:visible');
await go('articles/');
ok(await visible().count()===total,'unique article count');
ok(await p.locator('.card-link').evaluateAll(a=>new Set(a.map(x=>x.href)).size)===total,'no duplicate article links');
await p.selectOption('#catalog-topic','iisus-hristos');
ok(await visible().count()===inTopic('iisus-hristos'),'topic filter');
await p.selectOption('#catalog-sort','updated');
const dates=await visible().evaluateAll(a=>a.map(x=>x.dataset.date));
ok(dates.every((d,i)=>!i||dates[i-1]>=d),'date sort');
await p.goBack();ok(await p.inputValue('#catalog-sort')==='default','back restores sort');
await p.goBack();ok(await p.inputValue('#catalog-topic')==='','back restores topic');
await p.fill('#catalog-q','Ин 1:1');await p.locator('[data-catalog-form]').evaluate(f=>f.requestSubmit());
await p.waitForFunction(()=>document.querySelector('[data-catalog-status]').textContent.startsWith('Показано'));
ok((await visible().first().getAttribute('data-slug'))==='slovo-bylo-bog','passage search ranked result');
await p.fill('#catalog-q','zzqv987qzx');await p.locator('[data-catalog-form]').evaluate(f=>f.requestSubmit());
await p.waitForFunction(()=>document.querySelector('[data-catalog-empty]').hidden===false);
ok(await visible().count()===0,'empty result');
await p.click('.catalog-reset');ok(await visible().count()===total,'reset returns all articles');ok(await p.inputValue('#catalog-q')==='','reset clears query');
await go('articles/?topic=svyatoy-duh&sort=updated');ok(await visible().count()===inTopic('svyatoy-duh'),'shareable URL filters');
await go('articles/#spasenie');ok(await p.inputValue('#catalog-topic')==='spasenie','legacy topic hash');ok(await visible().count()===inTopic('spasenie'),'legacy topic results');
await go('');await p.click('.hero-actions a[href="#start"]');ok(await p.locator('#start').evaluate(e=>Math.abs(e.getBoundingClientRect().top)<60),'start CTA anchor');
await p.locator('.start-cards .card-link').first().click();ok((await p.locator('.intro-route').innerText()).includes('Статья 1 из 5'),'first step marker');
for(const slug of ['edinyy-istinnyy-bog','slovo-bylo-bog']){
 await go('answers/'+slug+'/');
 await p.evaluate(()=>{const r=document.querySelector('.prose').getBoundingClientRect();scrollTo(0,scrollY+r.bottom-innerHeight+3);});
 await p.waitForTimeout(100);
 ok(await p.locator('.read-progress').evaluate(e=>new DOMMatrix(getComputedStyle(e).transform).a)===1,'progress completes at end '+slug);
 await p.locator('.source-details summary').click();ok(await p.locator('.source-list').isVisible(),'sources can open');
}
await go('answers/edinyy-istinnyy-bog/#v22');ok(await p.locator('#v22').isVisible(),'legacy video anchor opens details');ok(await p.locator('.more-videos').getAttribute('open')!==null,'more videos opened');
await go('answers/slovo-bylo-bog/');await p.setViewportSize({width:1440,height:900});await p.waitForTimeout(80);
ok(await p.locator('.toc details').getAttribute('open')!==null,'desktop TOC open');
await p.evaluate(()=>scrollTo(0,3500));await p.waitForTimeout(80);
ok(await p.locator('.toc').evaluate(e=>e.getBoundingClientRect().top>=0&&e.getBoundingClientRect().top<30),'TOC sticks beside text');
ok(await p.locator('.prose').evaluate(e=>e.getBoundingClientRect().width===640),'reading column remains 640px');

await p.setViewportSize({width:390,height:844});await p.waitForTimeout(80);await p.locator('.sections-fab').click();ok(await p.locator('.sections-sheet').isVisible(),'mobile sections open');await p.keyboard.press('Escape');ok(!(await p.locator('.sections-sheet').isVisible()),'sections escape');
await p.evaluate(()=>scrollTo(0,0));await p.locator('.prose .vref').first().click();ok((await p.locator('.vpop').innerText()).includes('В начале было Слово'),'verse popup');await p.keyboard.press('Escape');
for(const width of [320,390,768,1280,1440]){
 await p.setViewportSize({width,height:900});
 for(const route of ['', 'about/', 'faith/', 'articles/', 'answers/edinyy-istinnyy-bog/', 'answers/slovo-bylo-bog/', 'answers/bog-krepkiy/']){
  await go(route);
  ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width+' '+route);
 }
}
await p.emulateMedia({colorScheme:'dark'});await p.setViewportSize({width:390,height:844});await go('articles/');
ok(await p.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)==='rgb(21, 24, 28)','dark theme');
const nojs=await browser.newPage({javaScriptEnabled:false,viewport:{width:390,height:844}});
await nojs.goto(base+'articles/');ok(await nojs.locator('.catalog-list .card:visible').count()===total,'no JS has all articles');ok(await nojs.locator('.catalog-filter').getAttribute('action')==='../search/index.html','no JS form has search destination');
await nojs.goto(base+'answers/slovo-bylo-bog/');await nojs.locator('.source-details summary').click();ok(await nojs.locator('.source-list').isVisible(),'no JS sources');await nojs.locator('.toc summary').click();ok(await nojs.locator('.toc ol').isVisible(),'no JS TOC');
const fail=await browser.newPage();await fail.route('**/assets/search-index.json',r=>r.abort());await fail.goto(base+'articles/');await fail.fill('#catalog-q','Логос');await fail.locator('[data-catalog-form]').evaluate(f=>f.requestSubmit());await fail.waitForFunction(()=>document.querySelector('[data-catalog-status]').textContent.includes('временно недоступен'));
ok(await fail.locator('[data-slug="slovo-bylo-bog"]').isVisible(),'catalog search fallback when index fails');
ok(errors.length===0,'no JS errors: '+errors.join(';'));
console.log(JSON.stringify({checks,errors,status:'passed'}));
} finally { await browser.close(); }
