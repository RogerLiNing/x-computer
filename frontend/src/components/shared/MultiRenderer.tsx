import { MarkdownContent } from './MarkdownContent';
import { ContentPreview } from './IsolatedPreview';
export interface MultiRendererProps {
  content:string;mode:'markdown'|'html'|'react';markdownClassName?:string;
}
export function MultiRenderer({content,mode,markdownClassName}:MultiRendererProps){
  if(mode==='html'||mode==='react')return <ContentPreview content={content} mode={mode}/>;
  return <div className={markdownClassName}><MarkdownContent content={content}/></div>;
}
