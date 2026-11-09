import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {BrowserComputerView,BrowserDownloads,BrowserUploads,BrowserTabs} from './BrowserComputerView';
describe('computer initial view',()=>{
 it('requires an explicit start and does not pretend an iframe is a running computer',()=>{
  const html=renderToStaticMarkup(<BrowserComputerView/>);
  expect(html).toContain('打开助手电脑');expect(html).toContain('助手会等待你交还');
  expect(html).not.toContain('<iframe');expect(html).not.toContain('data:image');
 });
});

describe('browser tabs',()=>{
 it('identifies the current page and disables tab mutations while the assistant holds control',()=>{
  const html=renderToStaticMarkup(<BrowserTabs tabs={[{id:'a',title:'<script>',url:'https://example.test',active:true}]} busy={false} driving={false} limit={8} onAction={()=>{}}/>);
  expect(html).toContain('aria-pressed="true"');expect(html).toContain('关闭第1个标签页');expect(html).toContain('新标签页');
  expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');
  expect(html.match(/disabled=""/g)).toHaveLength(3);
 });
});

describe('browser downloads',()=>{
 it('shows only recorded downloads and an explicit save action',()=>{
 const html=renderToStaticMarkup(<BrowserDownloads downloads={[{id:'id',name:'实际成果.txt',size:12}]} pending={1} busy={false} onSave={()=>{}}/>);
 expect(html).toContain('实际成果.txt');expect(html).toContain('保存并打开');expect(html).toContain('正在下载');expect(html).not.toContain('已验收');
 });
});

describe('upload consent card',()=>{
 const request={id:'upload',status:'pending',url:'https://example.com/form?token=private',file:{name:'内容.txt',path:'文档/内容.txt',size:12,sha256:'hash'}};
 it('shows the actual file and receiver, with explicit approval and rejection',()=>{const html=renderToStaticMarkup(<BrowserUploads requests={[request]} busy={false} onDecision={()=>{}}/>);expect(html).toContain('文档/内容.txt');expect(html).toContain('https://example.com/form');expect(html).not.toContain('token=private');expect(html).toContain('允许提供这份文件');expect(html).toContain('不提供');});
 it('does not offer replay for an unknown result',()=>{const html=renderToStaticMarkup(<BrowserUploads requests={[{...request,status:'unknown'}]} busy={false} onDecision={()=>{}}/>);expect(html).toContain('不会自动重试');expect(html).not.toContain('允许提供这份文件');});
 it('keeps old completed requests out of a different website current controls',()=>{const html=renderToStaticMarkup(<BrowserUploads requests={[{...request,status:'completed'}]} currentURL='https://other.example/form' busy={false} onDecision={()=>{}}/>);expect(html).not.toContain('文档/内容.txt');});

});
