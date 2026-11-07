import { build, transform } from 'esbuild';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
let runtime:Promise<string>|undefined;
const script=(value:string)=>value.replace(/<\/script/gi,'<\\/script');
export async function renderReact(content:string):Promise<string>{
  runtime??=build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';window.__xReact=React;window.__xCreateRoot=createRoot;",resolveDir:path.dirname(require.resolve('react/package.json'))},bundle:true,write:false,minify:true,format:'iife',platform:'browser',define:{'process.env.NODE_ENV':'"production"'}}).then(result=>result.outputFiles![0].text);
  const input=content.match(/```(?:jsx|tsx|react)?\s*\n([\s\S]*?)```/)?.[1]??content;
  const code=(await transform(input,{loader:'tsx',jsx:'transform',format:'cjs',target:'es2022'})).code;
  const execute=JSON.stringify(code+'\nreturn typeof Message === "function" ? Message : module.exports.default ?? module.exports.Message;').replace(/</g,'\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:12px;font-family:system-ui}</style></head><body><div id="root"></div><script>${script(await runtime)}</script><script>try{const module={exports:{}};const React=window.__xReact;const require=name=>{if(name==='react')return React;throw Error('请使用内置 React 或应用自己的资源')};const Component=new Function('React','require','module','exports',${execute})(React,require,module,module.exports);window.__xCreateRoot(document.getElementById('root')).render(React.createElement(Component));}catch(error){document.getElementById('root').textContent='内容暂时无法显示：'+error.message;}</script></body></html>`;
}
