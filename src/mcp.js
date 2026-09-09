import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { tools, callTool } from './tools.js';
const server=new McpServer({name:'ucas-companion',version:'0.1.0'});
for(const [name,t] of Object.entries(tools))server.registerTool(name,{description:t.description,inputSchema:t.schema,annotations:{readOnlyHint:t.readOnly||['search_campus','get_agenda','list_sources'].includes(name),destructiveHint:false}},async args=>{
 try{return {content:[{type:'text',text:JSON.stringify(await callTool(name,args))}]};}
 catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
});
await server.connect(new StdioServerTransport());
