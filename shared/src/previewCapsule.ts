export function previewCapsule(url:string,origin:string):string{
  const target=new URL(url,origin);
  if(target.origin!==origin||!/^\/api\/apps\/preview\/[\w-]+\/[\w-]{43}\//.test(target.pathname))throw new Error('预览地址无效');
  const scope=target.origin+target.pathname.split('/').slice(0,6).join('/')+'/';
  const encoded=JSON.stringify(target.href).replace(/</g,'\\u003c');
  // The trusted wrapper's frame-src also restricts navigations initiated by the inner app.
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${scope}; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}body{overflow:hidden}</style></head><body><iframe id="app" title="应用内容" sandbox="allow-scripts" allow="autoplay; fullscreen"></iframe><script>const app=document.getElementById('app');app.src=${encoded};addEventListener('message',e=>{if(e.source===app.contentWindow&&e.data?.type==='x_render_height'&&Number.isFinite(e.data.height))parent.postMessage({type:'x_render_height',height:Math.min(720,Math.max(120,e.data.height))},'*');else if(e.source===parent&&e.data?.type==='x_app_channel')app.contentWindow.postMessage(e.data,'*');});</script></body></html>`;
}
