import{createHash}from'node:crypto';
import type{ToolDefinition,ToolExecutorDeps,ToolHandler}from'../types.js';
import{parseFileToText}from'../../../fileParser/localFileParser.js';
import{SensitiveFilter}from'../../../security/SensitiveFilter.js';
export const fileExtractDefinition:ToolDefinition={name:'file.extract_text',displayName:'读取文档表格和演示文字',domain:['office','chat','agent'],riskLevel:'low',requiredPermissions:['fs.read'],
 description:'本地提取 PDF、DOCX、XLS/XLSX、PPTX 或文本的文字，提取过程不调用外部解析服务、不写入记忆；提取结果供当前模型处理，远端模型会收到提取文字。PDF 保留原页码；扫描 PDF 使用 ocr=true 在本地识别每页完整图像，每次最多10页，需服务端 Tesseract 中英文语言包；OCR 可能错字或遗漏，warnings 标记未识别页面，不能声称已读完这些页。每次返回一段文字，不代表物理页数；truncated=true 时使用 next_offset 继续并携带返回的 sha256。表格读取缓存值，不重算公式；演示仅含幻灯片文字，不含图片 OCR 或备注。旧 DOC/PPT 请先另存为新格式。',
 parameters:[{name:'ocr',type:'boolean',description:'扫描 PDF 设为 true，对完整页面本地 OCR；默认 false；保留原文字层并附加 OCR 文字，可能有重复。',required:false},{name:'path',type:'string',description:'工作区内文件的相对路径',required:true},{name:'offset',type:'number',description:'文本读取起点，默认 0',required:false},{name:'max_chars',type:'number',description:'本页最多字符数，默认 12000，上限 64000',required:false},{name:'expected_sha256',type:'string',description:'续读时传入上一页返回的 sha256，避免混用文件版本',required:false}]};
export function createFileExtractHandler(deps:ToolExecutorDeps):ToolHandler{
 return async(input,context)=>{
  const file=typeof input.path==='string'?input.path.trim():'',offset=input.offset??0,limit=input.max_chars??12000;
  if(input.ocr!==undefined&&typeof input.ocr!=='boolean')return {ok:false,error:'ocr 须为布尔值'};
  if(input.ocr===true&&!/\.pdf$/i.test(file))return {ok:false,error:'本地 OCR 当前支持 PDF 扫描页，图片请直接附到对话中识别'};
  if(!file||typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||typeof limit!=='number'||!Number.isSafeInteger(limit)||limit<1||limit>64000)return {ok:false,error:'文件路径或分页参数无效'};
  if(input.expected_sha256!==undefined&&(typeof input.expected_sha256!=='string'||!/^[a-f0-9]{64}$/i.test(input.expected_sha256)))return {ok:false,error:'文件指纹格式无效'};
  if(offset>0&&input.expected_sha256===undefined)return {ok:false,error:'续读请携带上一页返回的 sha256'};
  const sandbox=await deps.resolveFS(context);if(!sandbox)return {ok:false,error:'工作区不可用'};
  try{
   const buffer=await sandbox.readBinaryBounded(file),sha256=createHash('sha256').update(buffer).digest('hex');
   if(input.expected_sha256!==undefined&&String(input.expected_sha256).toLowerCase()!==sha256)return {ok:false,error:'文件版本已变化，请从头读取',sha256};
   const parsed=await parseFileToText(file,buffer,(context as {signal?:AbortSignal}|undefined)?.signal,input.ocr===true);if(!parsed.ok)return {ok:false,error:parsed.error};
   const text=SensitiveFilter.filter(parsed.content).filtered;
   if(!text&&['docx','xlsx','xls','pptx'].includes(parsed.fileType))return {ok:false,error:'没有可提取文字；图片或扫描内容尚未识别',sha256};
   if(offset>text.length)return {ok:false,error:'读取起点超过文本长度',total_chars:text.length,sha256};
   const high=(index:number)=>text.charCodeAt(index)>=0xd800&&text.charCodeAt(index)<=0xdbff,low=(index:number)=>text.charCodeAt(index)>=0xdc00&&text.charCodeAt(index)<=0xdfff;
   if(offset>0&&low(offset)&&high(offset-1))return {ok:false,error:'读取起点落在字符中间，请使用上一页的 next_offset'};
   let next=Math.min(text.length,offset+limit);if(next<text.length&&high(next-1)&&low(next))next+=next-offset===1?1:-1;
   const content=text.slice(offset,next);
   return {ok:true,path:file,fileType:parsed.fileType,content,offset,total_chars:text.length,next_offset:next<text.length?next:null,truncated:next<text.length,sha256,
    ...(parsed.warnings?.length?{warnings:parsed.warnings}:{}),
    extraction_scope:['xlsx','xls'].includes(parsed.fileType)?'cached-cell-values; formulas-not-recalculated':parsed.fileType==='pptx'?'slide-text; no-image-OCR-or-speaker-notes':parsed.fileType==='pdf'?(input.ocr===true?'page-numbered-text; full-page-local-OCR; no-layout':'page-numbered-text; no-image-OCR-or-layout'):'text-only; no-image-OCR'};
  }catch{return {ok:false,error:'文档读取未完成：文件可能损坏、过大或超出支持范围，请检查后重试'};}
 };
}
