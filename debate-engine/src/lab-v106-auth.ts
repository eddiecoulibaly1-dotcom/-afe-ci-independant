import { LAB_HTML as BASE_HTML, LAB_MANIFEST, LAB_SW, LAB_ICON } from "./lab-v106.js";

// V1.0.6 auth hardening: transparently refresh an expired Supabase access token
// before retrying authenticated API calls. The existing Lab keeps its session in
// localStorage; this wrapper makes that session resilient to access-token expiry
// without changing the debate UI or server authorization model.
const AUTH_REFRESH_FIX = String.raw`<script>(function(){
const originalFetch=window.fetch.bind(window);
const sessionKey='afe-v09-session';
let refreshPromise=null;
function readSession(){try{return JSON.parse(localStorage.getItem(sessionKey)||'null')}catch{return null}}
function saveSession(s){try{localStorage.setItem(sessionKey,JSON.stringify(s))}catch{}}
async function refreshSession(){
  if(refreshPromise)return refreshPromise;
  const s=readSession();
  if(!s?.refresh_token)return null;
  refreshPromise=(async()=>{
    try{
      const cfg=await originalFetch('/auth/config',{cache:'no-store'}).then(r=>r.json());
      if(!cfg?.supabaseUrl||!cfg?.publishableKey)return null;
      const r=await originalFetch(cfg.supabaseUrl.replace(/\\/$/,'')+'/auth/v1/token?grant_type=refresh_token',{
        method:'POST',
        headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},
        body:JSON.stringify({refresh_token:s.refresh_token})
      });
      const fresh=await r.json().catch(()=>null);
      if(!r.ok||!fresh?.access_token)return null;
      saveSession(fresh);
      return fresh.access_token;
    }catch{return null}
    finally{refreshPromise=null}
  })();
  return refreshPromise;
}
window.fetch=async function(input,init){
  const response=await originalFetch(input,init);
  if(response.status!==401)return response;
  const token=await refreshSession();
  if(!token)return response;
  const headers=new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization','Bearer '+token);
  return originalFetch(input,{...(init||{}),headers});
};
})();</script>`;

export const LAB_HTML = BASE_HTML.replace("</body>", AUTH_REFRESH_FIX + "</body>");
export { LAB_MANIFEST, LAB_SW, LAB_ICON };
