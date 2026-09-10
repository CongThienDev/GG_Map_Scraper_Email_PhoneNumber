import json,time,re,html,urllib.request,urllib.parse,urllib.robotparser,concurrent.futures,pathlib
from html.parser import HTMLParser
P=pathlib.Path(__file__).parent
EMAIL=re.compile(r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+")
class Parser(HTMLParser):
 def __init__(self): super().__init__(); self.links=[]; self.text=[]; self.hidden=0; self.cf=[]
 def handle_starttag(self,t,a):
  d=dict(a)
  if t in ('script','style'): self.hidden+=1
  if t=='a' and d.get('href'): self.links.append(d['href'])
  if d.get('data-cfemail'): self.cf.append(d['data-cfemail'])
 def handle_endtag(self,t):
  if t in ('script','style'): self.hidden=max(0,self.hidden-1)
 def handle_data(self,d):
  if not self.hidden:self.text.append(d)
def fetch(url):
 t=time.monotonic()
 try:
  req=urllib.request.Request(url,headers={'User-Agent':'WebsiteContactPilot/1.0','Accept':'text/html,application/xhtml+xml'})
  with urllib.request.urlopen(req,timeout=15) as r:
   raw=r.read(2500000); body=raw.decode(r.headers.get_content_charset() or 'utf-8',errors='replace')
   return dict(url=url,final_url=r.url,status=r.status,seconds=round(time.monotonic()-t,3),body=body,bytes=len(raw))
 except Exception as e:return dict(url=url,error=str(e),seconds=round(time.monotonic()-t,3))
def analyze(r):
 if 'body' not in r:return r
 p=Parser();p.feed(r['body']); txt=' '.join(p.text); mails=[]
 for h in p.links:
  if h.lower().startswith('mailto:'):mails+=EMAIL.findall(urllib.parse.unquote(h.split('?',1)[0][7:]))
 decoded=[]
 for x in p.cf:
  try:
   b=bytes.fromhex(x);decoded.append(''.join(chr(i^b[0]) for i in b[1:]))
  except Exception:pass
 r.update(raw_candidates=sorted(set(EMAIL.findall(html.unescape(r['body'])))),text_candidates=sorted(set(EMAIL.findall(txt))),mailto=sorted(set(mails)),cf_decoded=decoded,snippets=[txt[max(0,m.start()-120):m.end()+150] for m in EMAIL.finditer(txt)],links=p.links)
 return r
def job(item):
 t=time.monotonic();url=item['Website'];root=urllib.parse.urlsplit(url); robots=fetch(urllib.parse.urlunsplit((root.scheme,root.netloc,'/robots.txt','','')))
 rp=urllib.robotparser.RobotFileParser();rp.parse(robots.get('body','').splitlines())
 allowed=lambda u: rp.can_fetch('WebsiteContactPilot',u) if robots.get('status')==200 else True
 result={'input':item,'robots':{k:v for k,v in robots.items() if k!='body'},'pages':[]}
 if not allowed(url):result['policy']='robots_disallowed'
 else:
  home=analyze(fetch(url)); result['pages'].append(home)
  if 'body' in home:
   urls=[]
   for h in home['links']:
    u=urllib.parse.urljoin(home['final_url'],h);s=urllib.parse.urlsplit(u)
    if s.scheme in ('http','https') and s.netloc==urllib.parse.urlsplit(home['final_url']).netloc and re.search(r'contact|location|about',s.path,re.I) and not re.search(r'privacy|terms|\.jpg|\.png',u,re.I):
     u=urllib.parse.urlunsplit((s.scheme,s.netloc,s.path,s.query,''))
     if u not in urls and u.rstrip('/')!=home['final_url'].rstrip('/') and allowed(u):urls.append(u)
   urls.sort(key=lambda u:0 if 'contact' in u.lower() else 1)
   for u in urls[:2]:result['pages'].append(analyze(fetch(u)))
 for i,p in enumerate(result['pages']):
  if 'body' in p:(P/f"http-{item['excel_row']}-{i}.html").write_text(p.pop('body'))
 result['seconds']=round(time.monotonic()-t,3)
 (P/f"http-{item['excel_row']}.json").write_text(json.dumps(result,indent=2,ensure_ascii=False))
 print(json.dumps({'row':item['excel_row'],'name':item['Name'],'seconds':result['seconds'],'pages':[{k:v for k,v in p.items() if k not in ('links','snippets')} for p in result['pages']]},ensure_ascii=False),flush=True)
 return result
if __name__=='__main__':
 items=json.loads((P/'sample.json').read_text());start=time.monotonic()
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(job,items))
 (P/'http-results.json').write_text(json.dumps({'elapsed':time.monotonic()-start,'results':results},ensure_ascii=False,indent=2))
