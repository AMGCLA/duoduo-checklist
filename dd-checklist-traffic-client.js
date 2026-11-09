/* Independent Checklist visits for the owner-only analytics dashboard.
 * Does not change GoatCounter's existing public widget or Checklist task storage. */
(()=>{'use strict';
 if(window.top!==window||!location.pathname.startsWith('/duoduo-checklist/'))return;
 if(!navigator.onLine)return;
 const navigation=performance.getEntriesByType?.('navigation')?.[0];
 if(navigation?.type==='reload')return;
 const hex=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
 let visitor;
 try{
   visitor=localStorage.getItem('duoduo_anonymous_visitor_v1');
   if(!/^[a-f0-9]{32}$/i.test(visitor||'')){
     visitor=hex();
     localStorage.setItem('duoduo_anonymous_visitor_v1',visitor);
   }
 }catch(_){visitor=hex()}
 try{
   fetch('https://duoduo-website.onrender.com/api/traffic/record',{
     method:'POST',mode:'cors',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({site:'checklist',visitorId:visitor,viewId:hex()}),
     keepalive:true,cache:'no-store'
   }).catch(()=>{});
 }catch(_){/* Analytics must never block the Checklist. */}
})();