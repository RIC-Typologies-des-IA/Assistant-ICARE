const ALLOWED_TAGS=new Set(["A","BR","P","STRONG","B","EM","I","DEL","UL","OL","LI","BLOCKQUOTE","PRE","CODE","H1","H2","H3","H4","H5","H6","HR"]);
const escapeHtml=value=>String(value).replace(/[&<>"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[char]));
function inlineMarkdown(value){
 let html=escapeHtml(value);
 html=html.replace(/&lt;br\s*\/?&gt;/gi,"<br>");
 html=html.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/__(.+?)__/g,"<strong>$1</strong>");
 html=html.replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/_(.+?)_/g,"<em>$1</em>");
 html=html.replace(/~~(.+?)~~/g,"<del>$1</del>").replace(/\x60([^\x60]+)\x60/g,"<code>$1</code>");
 html=html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2">$1</a>');
 return html;
}
function sanitize(root){
 for(const node of [...root.childNodes]){
  if(node.nodeType===3)continue;
  if(node.nodeType!==1||!ALLOWED_TAGS.has(node.tagName)){node.replaceWith(document.createTextNode(node.textContent||""));continue;}
  for(const attribute of [...node.attributes]){
   if(node.tagName==="A"&&attribute.name==="href"&&/^https?:/i.test(attribute.value))continue;
   node.removeAttribute(attribute.name);
  }
  if(node.tagName==="A"){node.target="_blank";node.rel="noopener noreferrer";}
  sanitize(node);
 }
}
function renderMarkdown(source){
 const lines=String(source??"").replace(/\r\n?/g,"\n").split("\n");
 const output=[];let paragraph=[],list=null,code=null,quote=[];
 const flushParagraph=()=>{if(paragraph.length){output.push("<p>"+paragraph.map(inlineMarkdown).join("<br>")+"</p>");paragraph=[];}};
 const closeList=()=>{if(list){output.push("</"+list+">");list=null;}};
 const flushQuote=()=>{if(quote.length){const inner=renderMarkdown(quote.join("\n"));const holder=document.createElement("div");holder.append(inner);output.push("<blockquote>"+holder.innerHTML+"</blockquote>");quote=[];}};
 for(const line of lines){
  const fence=/^\s*\x60{3}/.test(line);
  if(code){if(fence){output.push("<pre><code>"+escapeHtml(code.join("\n"))+"</code></pre>");code=null;}else code.push(line);continue;}
  if(fence){flushParagraph();closeList();flushQuote();code=[];continue;}
  if(/^\s*>/.test(line)){flushParagraph();closeList();quote.push(line.replace(/^\s*>\s?/,""));continue;}
  flushQuote();
  if(!line.trim()){flushParagraph();closeList();continue;}
  const heading=line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
  if(heading){flushParagraph();closeList();const level=heading[1].length;output.push("<h"+level+">"+inlineMarkdown(heading[2])+"</h"+level+">");continue;}
  const item=line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
  if(item){flushParagraph();const kind=/^\d/.test(item[1])?"ol":"ul";if(list!==kind){closeList();output.push("<"+kind+">");list=kind;}output.push("<li>"+inlineMarkdown(item[2])+"</li>");continue;}
  closeList();paragraph.push(line);
 }
 flushParagraph();closeList();flushQuote();
 if(code)output.push("<pre><code>"+escapeHtml(code.join("\n"))+"</code></pre>");
 const template=document.createElement("template");template.innerHTML=output.join("");sanitize(template.content);return template.content;
}
export {renderMarkdown};
