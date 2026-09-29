import fs from 'node:fs';
import path from 'node:path';
import { createKanbanStore } from '../lib/kanban.js';
import { RADAR_SOURCES } from '../lib/radar.js';

export function seedDemo(root) {
  const home=path.join(root,'home'),dataDir=path.join(root,'data'),projectsDir=path.join(home,'dev','GitHub');
  const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value,null,2));};
  const projects=[['cloud-notes','Una aplicación de notas con API serverless y almacenamiento local.'],['agent-kit','Herramientas para coordinar entregas entre agentes.'],['portfolio','Portafolio técnico con casos y demostraciones.']];
  for(const[name,desc]of projects)write(path.join(projectsDir,name,'CLAUDE.md'),`# ${name}\n\n${desc}\n\n## Ejecutar\nnpm start\n\n## Mejoras\n- Revisar accesibilidad y añadir pruebas de integración.\n`);
  write(path.join(home,'.claude.json'),{oauthAccount:{emailAddress:'developer@example.com',organizationName:'Cuenta de ejemplo',organizationType:'individual'}});
  const stamp=new Date().toISOString();
  write(path.join(home,'.codex','sessions','demo','rollout-demo.jsonl'),[
    {type:'session_meta',timestamp:stamp,payload:{id:'codex-demo',cwd:path.join(projectsDir,'cloud-notes')}},
    {type:'turn_context',timestamp:stamp,payload:{model:'gpt-6-sol'}},
    {type:'event_msg',timestamp:stamp,payload:{type:'token_count',info:{total_token_usage:{input_tokens:18000,output_tokens:4200,cached_input_tokens:10000}}}},
  ].map(x=>JSON.stringify(x)).join('\n')+'\n');
  write(path.join(home,'.grok','sessions','demo','summary.json'),{info:{id:'grok-demo',cwd:path.join(projectsDir,'agent-kit')},created_at:stamp,last_active_at:stamp,num_chat_messages:8});
  write(path.join(home,'.grok','sessions','demo','usage.json'),{sessionId:'grok-demo',updatedAt:stamp,session:{primaryModelId:'grok-demo'},turns:[{turnNumber:1,endedAt:stamp,inputTokens:12000,outputTokens:2200,cachedReadTokens:7000,costUsdTicks:180000000}]});
  for(let day=0;day<12;day++) {
    const stamp=new Date(Date.now()-day*86400000).toISOString(),name=projects[day%3][0],cwd=path.join(projectsDir,name),rows=[];
    for(let i=0;i<3;i++)rows.push({type:'user',timestamp:stamp,cwd,message:{content:`Revisar pruebas y documentación de ${name}. Datos sintéticos.`}},{type:'assistant',timestamp:stamp,cwd,message:{id:`demo-${day}-${i}`,model:'claude-sonnet-5',content:[{type:'text',text:'Ejemplo de revisión: preparar pruebas y dejar contexto de entrega.'},{type:'tool_use',id:`tool-${day}-${i}`,name:'Read',input:{file_path:'README.md'}}],usage:{input_tokens:700+day*40,output_tokens:1400+day*120,cache_read_input_tokens:12000+day*1300,cache_creation_input_tokens:4000,cache_creation:{ephemeral_5m_input_tokens:4000,ephemeral_1h_input_tokens:0}}}});
    write(path.join(home,'.claude','projects',`demo-${name}`,`session-${day}.jsonl`),rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
  }
  for(const[name,description]of [['frontend-review','Revisar jerarquía, teclado y responsive.'],['testing','Comprobar cambios con pruebas reproducibles.'],['handoff','Preparar contexto para la siguiente IA.']])write(path.join(home,'.claude','skills',name,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\n---\n\nDatos de ejemplo.\n`);
  const board=createKanbanStore({dataDir});
  for(const task of [
    {title:'Documentar la primera instalación',project:'agent-kit',agent:'human',status:'backlog',priority:'high',description:'Reducir a tres pasos el inicio de la herramienta.',acceptance:'Una persona nueva puede arrancar desde el README.'},
    {title:'Verificar API y errores de entrada',project:'cloud-notes',agent:'codex',status:'doing',priority:'high',description:'Comprobar respuestas y entradas inválidas.',acceptance:'Suite de API y casos de error pasan.',handoff:'Fixtures listos; revisar las respuestas 400 y 404.'},
    {title:'Revisar navegación con teclado',project:'portfolio',agent:'claude',status:'review',priority:'medium',description:'Recorrer enlaces, menús y formularios.',acceptance:'Foco visible y recorrido completo.'},
    {title:'Explorar un patrón serverless',project:'cloud-notes',agent:'grok',status:'backlog',priority:'medium',description:'Comparar una opción sencilla para la siguiente mejora.',acceptance:'Documentar tradeoffs y fuente oficial.'},
    {title:'Pulir la entrega móvil',project:'portfolio',agent:'agy',status:'done',priority:'low',description:'Ajustar lectura y controles en pantallas pequeñas.',acceptance:'Comprobado en 390 y 768 px.',handoff:'Entrega de ejemplo: controles accesibles y capturas revisadas.'},
  ])board.mutate({action:'create',task});
  const now=new Date().toISOString();
  write(path.join(dataDir,'radar.json'),{version:1,enabled:false,marks:{},sources:Object.fromEntries(RADAR_SOURCES.map(s=>[s.id,{attemptedAt:now,fetchedAt:now,error:null}])),items:[
    {id:'demo-architecture',sourceId:'architecture',sourceName:'AWS Architecture Blog',kind:'official',section:'architecture',title:'[Ejemplo] Una arquitectura serverless para tu siguiente proyecto',url:'https://aws.amazon.com/blogs/architecture/',summary:'Contenido sintético para mostrar cómo explorar y guardar una arquitectura. El enlace abre la fuente, no una publicación específica.',publishedAt:now,dateKind:'published',topics:['Serverless'],author:null},
    {id:'demo-job',sourceId:'remotive',sourceName:'Remotive',kind:'jobs',section:'jobs',title:'[Ejemplo] Cloud Engineer — remoto LATAM',url:'https://remotive.com/',summary:'Vacante ficticia de demostración: AWS, Terraform, Docker y Python. No representa una oferta real.',publishedAt:now,dateKind:'published',topics:[],company:'Empresa de ejemplo',location:'LATAM',region:'latam-global',remote:true,salary:null,author:null},
  ]});
  return {home,dataDir,projectsDir};
}
