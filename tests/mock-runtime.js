(()=>{const store={};window.__store=store;
const mk=path=>({id:path.split('/').pop(),path,
 get:async()=>({exists:path in store,data:()=>store[path]?JSON.parse(JSON.stringify(store[path])):undefined,metadata:{}}),
 set:async d=>{store[path]=JSON.parse(JSON.stringify(d))},update:async d=>{Object.assign(store[path],d)},delete:async()=>{delete store[path]}});
const db={doc:mk,collection:p=>({doc:id=>mk(p+'/'+id)})};
window.__saved=[];
window.claude={use:async n=>n==='db'?db:n==='user'?{isOwner:()=>true,id:async()=>'u1',can:()=>true,canEdit:()=>true}:n==='downloads'?{save:async({filename,data})=>{window.__saved.push(filename);if(data instanceof Blob)window.__lastBlobSize=data.size;return{status:'saved'}}}:null};})();
