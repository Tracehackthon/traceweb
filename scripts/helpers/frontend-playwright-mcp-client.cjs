// Host-kernel-independent client for the exact project-configured Playwright
// MCP server. JSON lines are MCP calls, not an alternate browser controller.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {pathToFileURL}=require('node:url');
const {directory}=require('./frontend-browser-tools.cjs');
const web=path.resolve(__dirname,'../..'),runtime=path.resolve(web,'../trace-runtime');
async function main(){
  const {Client}=await import(pathToFileURL(path.join(runtime,'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
  const {StdioClientTransport}=await import(pathToFileURL(path.join(runtime,'apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href);
  fs.mkdirSync(directory,{recursive:true});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(__dirname,'frontend-browser-tools.cjs'),'mcp'],cwd:web,stderr:'pipe'});
  const errors=fs.createWriteStream(path.join(directory,'playwright-mcp-stderr.log'),{flags:'a'});
  transport.stderr.on('data',bytes=>errors.write(bytes));
  const client=new Client({name:'trace-frontend-verification',version:'1.0.0'},{capabilities:{}});
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await client.close();errors.end();};
  try{
    await client.connect(transport);const listing=await client.listTools();
    fs.writeFileSync(path.join(directory,'mcp-tools.json'),JSON.stringify(listing,null,2)+'\n');
    console.log(JSON.stringify({connected:true,transport:'stdio',server:'@playwright/mcp@0.0.84',tools:listing.tools.map(t=>t.name)}));
    const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
    for await(const line of input){
      if(!line.trim())continue;
      let request;try{request=JSON.parse(line);if(request.close){await close();console.log(JSON.stringify({id:request.id,closed:true}));break;}
        const result=await client.callTool({name:request.name,arguments:request.arguments||{}},undefined,{timeout:120000});
        const content=(result.content||[]).map(item=>item.type==='image'?{type:'image',mimeType:item.mimeType,base64Bytes:item.data.length}:item);
        const response={id:request.id,isError:result.isError||false,content};
        fs.appendFileSync(path.join(directory,'mcp-calls.jsonl'),JSON.stringify({at:new Date().toISOString(),request,response})+'\n');
        console.log(JSON.stringify(response));
      }catch(error){console.log(JSON.stringify({id:request?.id,error:error.message}));}
    }
  }finally{await close();}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
