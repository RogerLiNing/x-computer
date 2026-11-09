import { describe,it,expect } from 'vitest';
import { previewCapsule } from './IsolatedPreview';
describe('generated preview navigation boundary',()=>{
 it('uses a trusted wrapper that allows only its delegated asset scope and never shares origin',()=>{
  const path='/api/apps/preview/alice/'+ 'a'.repeat(43)+'/index.html';
  const html=previewCapsule(path,'https://x.example');
  expect(html).toContain('frame-src https://x.example/api/apps/preview/alice/');expect(html).toContain('sandbox="allow-scripts"');
  expect(html).not.toContain('allow-same-origin');expect(html).not.toContain('allow-popups');expect(html).toContain('e.source===app.contentWindow');
 });
 it('refuses arbitrary URLs and account API endpoints in the trusted wrapper',()=>{
  expect(()=>previewCapsule('https://evil.example/page','https://x.example')).toThrow();
  expect(()=>previewCapsule('/api/users/me/config','https://x.example')).toThrow();
 });
});
