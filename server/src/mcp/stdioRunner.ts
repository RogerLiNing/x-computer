/** Runs inside the extension container; only its owner workspace is mounted. */
export const MCP_STDIO_RUNNER = String.raw`
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const {mkdirSync}=require('node:fs');
mkdirSync('/tmp/x-mcp',{recursive:true,mode:0o700});
let child,closing=false;
const kill=()=>{if(closing)return;closing=true;if(child?.pid){try{process.kill(-child.pid,'SIGTERM')}catch{}setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}process.exit(0)},300)}else process.exit(0)};
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
lines.on('line',line=>{
 try{
  if(!child){const config=JSON.parse(line);child=spawn(config.command,config.args,{cwd:'/tmp/x-mcp',detached:true,stdio:['pipe','pipe','pipe'],env:{...config.env,HOME:'/tmp/x-mcp',USER:'xuser',PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8'}});
   process.stderr.write(JSON.stringify({xMcpPid:child.pid})+'\n');
   child.stdout.pipe(process.stdout,{end:false});child.stderr.pipe(process.stderr,{end:false});
   child.stdin.on('error',kill);child.on('error',kill);child.on('exit',kill);
  }else child.stdin.write(line+'\n');
 }catch{kill()}
});
lines.on('close',kill);process.on('SIGTERM',kill);process.on('SIGINT',kill);
`;
