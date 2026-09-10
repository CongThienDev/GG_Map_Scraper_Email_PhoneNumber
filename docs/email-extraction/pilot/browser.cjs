const fs=require('fs'),path=require('path'),puppeteer=require('puppeteer');
const dir=__dirname;
const http=JSON.parse(fs.readFileSync(path.join(dir,'http-results.json')));
async function snapshot(page){return page.evaluate(()=>{
 const roots=[document];for(let i=0;i<roots.length;i++)for(const e of roots[i].querySelectorAll('*'))if(e.shadowRoot)roots.push(e.shadowRoot);
 const mailto=roots.flatMap(r=>Array.from(r.querySelectorAll('a[href^="mailto:"]')).map(a=>({href:a.getAttribute('href'),text:a.innerText,context:a.parentElement?.innerText?.slice(0,900),visible:a.getClientRects().length>0&&getComputedStyle(a).visibility!=='hidden'})));
 const text=document.body?.innerText||''; const re=/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
 return {title:document.title,text,emails:[...new Set(text.match(re)||[])],mailto,shadowRoots:roots.length-1,forms:[...document.forms].map(f=>({action:f.action,fields:[...f.elements].map(e=>({tag:e.tagName,type:e.type,name:e.name,placeholder:e.placeholder}))})),links:[...document.querySelectorAll('a[href]')].map(a=>({text:a.innerText,url:a.href})).filter(a=>/email|contact|location|88th|marine|union/i.test(a.text+' '+a.url))};
 });}
async function main(){
 const start=Date.now();const browser=await puppeteer.launch({headless:true});
 let cursor=0;const results=[];
 async function worker(){while(cursor<http.results.length){const h=http.results[cursor++],row=h.input.excel_row;
  if(!h.pages[0]?.final_url){results.push({row,skipped:'HTTP DNS/error; not retried in browser'});continue;}
  const ctx=await browser.createBrowserContext(),page=await ctx.newPage();await page.setViewport({width:1365,height:900});page.setDefaultNavigationTimeout(20000);
  const result={row,name:h.input.Name,pages:[]};
  try{for(const [i,p] of h.pages.slice(0,2).entries()){
   const t=Date.now(),rec={url:p.final_url||p.url};
   try{const res=await page.goto(rec.url,{waitUntil:'domcontentloaded'});rec.status=res?.status();
    await new Promise(r=>setTimeout(r,1800));rec.initial=await snapshot(page);
    await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await new Promise(r=>setTimeout(r,1800));rec.afterScroll=await snapshot(page);
    rec.final_url=page.url();rec.frames=page.frames().map(f=>f.url());
    await page.screenshot({path:path.join(dir,`browser-${row}-${i}.png`)});
    fs.writeFileSync(path.join(dir,`browser-${row}-${i}.html`),await page.content());
   }catch(e){rec.error=e.message;}rec.seconds=(Date.now()-t)/1000;result.pages.push(rec);
   console.log(JSON.stringify({row,url:rec.final_url||rec.url,seconds:rec.seconds,status:rec.status,error:rec.error,emails:rec.afterScroll?.emails,mailto:rec.afterScroll?.mailto,frames:rec.frames}));
  }}finally{await ctx.close();}
  results.push(result);fs.writeFileSync(path.join(dir,`browser-${row}.json`),JSON.stringify(result,null,2));
 }}
 try{await Promise.all([worker(),worker()]);}finally{await browser.close();}
 fs.writeFileSync(path.join(dir,'browser-results.json'),JSON.stringify({elapsedSeconds:(Date.now()-start)/1000,method:'Two contexts; no resource blocking; DOMContentLoaded + 1.8s, scroll bottom + 1.8s; max two pages per website. Fixed waits are pilot instrumentation, not production readiness detection.',results},null,2));
}main().catch(e=>{console.error(e);process.exit(1)});
