import {inflateRawSync} from 'node:zlib';
const MAX_INPUT=16*1024*1024,MAX_EXPANDED=32*1024*1024,MAX_XML=4*1024*1024;
const CRC_TABLE=Uint32Array.from({length:256},(_value,index)=>{let crc=index;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;return crc>>>0;});
function crc32(data:Buffer){let crc=0xffffffff;for(const byte of data)crc=CRC_TABLE[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function xmlLimits(data:Buffer,budget:{tags:number;attributes:number}){
 if(data.length>MAX_XML)throw new Error('文档 XML 超过 4 MiB，请拆分文档');
 let text:string;
 if(data[0]===0xff&&data[1]===0xfe||data[0]===0x3c&&data[1]===0)text=data.toString('utf16le');
 else if(data[0]===0xfe&&data[1]===0xff||data[0]===0&&data[1]===0x3c){if(data.length%2)throw new Error('XML 编码无效');text=Buffer.from(data).swap16().toString('utf16le');}
 else{text=data.toString('utf8');if(text.slice(0,100).includes('\0'))throw new Error('不支持该 XML 编码，请另存为标准 Office 文件');}
 text=text.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g,'');
 if(/<!\s*(DOCTYPE|ENTITY)\b/i.test(text))throw new Error('不接受含外部文档或实体声明的 Office 文件');
 let depth=0;
 for(let i=0;i<text.length;i++){
  if(text[i]!=='<')continue;const closing=text[i+1]==='/';let quote='';let end=i+1;
  for(;end<text.length;end++){
   const c=text[end];if(quote){if(c===quote)quote='';continue;}
   if(c==='"'||c==="'"){quote=c;continue;}
   if(c==='='&&++budget.attributes>100000)throw new Error('文档属性过多，请拆分文档');
   if(c==='>')break;
  }
  if(end===text.length)throw new Error('XML 内容不完整');
  if(text[i+1]!=='?'){
   if(++budget.tags>200000)throw new Error('文档节点过多，请拆分文档');
   if(closing)depth--;else if(text[end-1]!=='/')depth++;
   if(depth>128||depth<0)throw new Error('文档嵌套层级无效或过深');
  }
  i=end;
 }
 if(depth!==0)throw new Error('XML 标签未闭合');
}
function extras(buffer:Buffer,start:number,length:number){
 const end=start+length;for(let i=start;i<end;){if(i+4>end)throw new Error('ZIP 扩展信息无效');const kind=buffer.readUInt16LE(i),size=buffer.readUInt16LE(i+2);if(kind===1||kind===0x7075)throw new Error('暂不支持 ZIP64 或替代路径扩展');i+=4+size;if(i>end)throw new Error('ZIP 扩展信息不完整');}
}
function looksLikeXml(data:Buffer):boolean{
 if(data[0]===0xff&&data[1]===0xfe||data[0]===0xfe&&data[1]===0xff||data[0]===0&&data[1]===0x3c||data[0]===0x3c&&data[1]===0)return true;
 let index=data[0]===0xef&&data[1]===0xbb&&data[2]===0xbf?3:0;
 while([9,10,13,32].includes(data[index]))index++;
 return data[index]===0x3c;
}
/** Bound native inflation before passing the archive to Office parsers; never trust declared sizes alone. */
export function validateOfficeArchive(buffer:Buffer):void{
 if(buffer.length>MAX_INPUT||buffer.length<22)throw new Error('Office 文件无效或超过 16 MiB');
 let end=-1;
 for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50&&i+22+buffer.readUInt16LE(i+20)===buffer.length){end=i;break;}
 if(end<0)throw new Error('不是完整的 Office ZIP 文件');
 const count=buffer.readUInt16LE(end+10),size=buffer.readUInt32LE(end+12),start=buffer.readUInt32LE(end+16);
 if(buffer.readUInt16LE(end+4)||buffer.readUInt16LE(end+6)||buffer.readUInt16LE(end+8)!==count||count>1024||count===0||start+size!==end)throw new Error('Office 压缩包结构不支持或文件过多');
 const names=new Set<string>(),budget={tags:0,attributes:0};let position=start,total=0;
 for(let index=0;index<count;index++){
  if(position+46>end||buffer.readUInt32LE(position)!==0x02014b50)throw new Error('Office ZIP 目录无效');
  const flags=buffer.readUInt16LE(position+8),method=buffer.readUInt16LE(position+10),compressed=buffer.readUInt32LE(position+20),expanded=buffer.readUInt32LE(position+24),nameLength=buffer.readUInt16LE(position+28),extraLength=buffer.readUInt16LE(position+30),commentLength=buffer.readUInt16LE(position+32),local=buffer.readUInt32LE(position+42);
  const next=position+46+nameLength+extraLength+commentLength;if(next>end||buffer.readUInt16LE(position+34)||flags&0x2041||![0,8].includes(method))throw new Error('不支持加密、多卷或特殊压缩 Office 文件');
  const nameBytes=buffer.subarray(position+46,position+46+nameLength),name=nameBytes.toString('utf8');
  if(!name||name.startsWith('/')||/^[a-z]:/i.test(name)||name.includes('\\')||/[\x00-\x1f]/.test(name)||name.split('/').some((part,i,all)=>part==='..'||(!part&&i<all.length-1))||names.has(name.toLowerCase()))throw new Error('Office 文件包含异常或重复路径');names.add(name.toLowerCase());
  extras(buffer,position+46+nameLength,extraLength);
  total+=expanded;if(total>MAX_EXPANDED)throw new Error('Office 解压内容超过 32 MiB，请拆分文档');
  if(local+30>start||buffer.readUInt32LE(local)!==0x04034b50||buffer.readUInt16LE(local+6)!==flags||buffer.readUInt16LE(local+8)!==method)throw new Error('Office ZIP 文件头不一致');
  const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28),dataStart=local+30+localName+localExtra;
  if(dataStart+compressed>start||!buffer.subarray(local+30,local+30+localName).equals(nameBytes))throw new Error('Office ZIP 数据范围无效');extras(buffer,local+30+localName,localExtra);
  const crc=buffer.readUInt32LE(position+16),localCrc=buffer.readUInt32LE(local+14),localCompressed=buffer.readUInt32LE(local+18),localExpanded=buffer.readUInt32LE(local+22);
  if(flags&8){
   if(localCrc&&localCrc!==crc||localCompressed&&localCompressed!==compressed||localExpanded&&localExpanded!==expanded)throw new Error('Office ZIP 流式大小不一致');
   const marker=dataStart+compressed,valid=(offset:number)=>offset+12<=start&&buffer.readUInt32LE(offset)===crc&&buffer.readUInt32LE(offset+4)===compressed&&buffer.readUInt32LE(offset+8)===expanded;
   if(!valid(marker)&&!(marker+4<=start&&buffer.readUInt32LE(marker)===0x08074b50&&valid(marker+4)))throw new Error('Office ZIP 流式描述无效');
  }else if(localCrc!==crc||localCompressed!==compressed||localExpanded!==expanded)throw new Error('Office ZIP 本地大小不一致');
  const packed=buffer.subarray(dataStart,dataStart+compressed),xml=/\.(xml|rels)$/i.test(name);
  let data:Buffer;try{data=method===0?packed:inflateRawSync(packed,{maxOutputLength:Math.min(xml?MAX_XML:MAX_EXPANDED,MAX_EXPANDED-total+expanded)+1});}catch{throw new Error('Office 解压失败或解压内容过大');}
  if(data.length!==expanded||(xml&&data.length>MAX_XML))throw new Error('Office 压缩内容大小不一致或 XML 过大');
  if(crc32(data)!==crc)throw new Error('Office 文件校验失败，内容可能损坏');
  if(xml||looksLikeXml(data))xmlLimits(data,budget);position=next;
 }
 if(position!==end)throw new Error('Office ZIP 目录长度不一致');
}
export function validateSpreadsheetFile(buffer:Buffer):void{
 if(buffer.subarray(0,2).toString()==='PK'){validateOfficeArchive(buffer);return;}
 if(buffer.length<512||buffer.length>MAX_INPUT||!buffer.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw new Error('不是受支持的 XLS/XLSX 文件，请另存为标准工作簿');
 const version=buffer.readUInt16LE(26),shift=buffer.readUInt16LE(30);
 if(buffer.readUInt16LE(28)!==0xfffe||!((version===3&&shift===9)||(version===4&&shift===12))||buffer.readUInt16LE(32)!==6)throw new Error('旧 XLS 文件头无效');
 const sectorSize=2**shift,sectors=buffer.length/sectorSize-1;
 if(!Number.isInteger(sectors)||sectors<1||[40,44,64,72].some(offset=>buffer.readUInt32LE(offset)>sectors))throw new Error('旧 XLS 扇区范围无效');
}
