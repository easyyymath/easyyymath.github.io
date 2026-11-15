export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sub=s=>s==='geometry'||s==='Геометрія'?'geometry':'algebra';
export const subName=s=>sub(s)==='geometry'?'Геометрія':'Алгебра';
export function rich(s){return esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>')}
export function latex(s){let v=String(s||'').trim();return /\\\[|\\\(|\$\$|(?<!\\)\$/.test(v)?esc(v):'\\['+esc(v)+'\\]'}
export async function typeset(el){if(!window.MathJax)return;try{await MathJax.startup.promise;MathJax.typesetClear([el]);await MathJax.typesetPromise([el])}catch(e){console.warn(e)}}
export function safeUrl(u){try{let x=new URL(u,location.href);return /^https?:$/.test(x.protocol)?x.href:''}catch{return ''}}
export function normalize(v){return String(v??'').trim().toLowerCase().replace(/[−–]/g,'-').replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,'$1/$2').replace(/\\(?:text|mathrm)\s*\{([^{}]+)\}/g,'$1').replace(/\s+/g,'').replace(/,/g,'.')}
export function numeric(s){s=normalize(s);if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s))return Number(s);let m=s.match(/^([+-]?\d+)\/([+-]?\d+)$/);return m&&+m[2]!==0?+m[1]/+m[2]:null}
export function matches(answer,expected){let a=normalize(answer),b=normalize(expected);if(!a||!b)return false;if(a===b)return true;let x=numeric(a),y=numeric(b);return x!==null&&y!==null&&Math.abs(x-y)<1e-9}
export function checkAnswer(answer,variants){return String(variants||'').split(';').some(v=>matches(answer,v.trim()))}
export function progressStats(p={}){let ks=Object.keys(p).filter(k=>p[k]);return {quiz:ks.filter(k=>/:q\d+$/.test(k)).length,practice:ks.filter(k=>/:p\d+$/.test(k)).length,legacyStars:ks.reduce((n,k)=>n+(/:q\d+$/.test(k)?10:/:p\d+$/.test(k)?5:0),0)}}
export function getEarned(user={}){return Number.isFinite(user.earnedStars)?user.earnedStars:progressStats(user.progress||{}).legacyStars}
export function getBalance(user={}){return Math.max(0,getEarned(user)-Number(user.spentStars||0))}
