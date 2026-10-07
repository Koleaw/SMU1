import { object, array, mm, boolean, fail } from './geometry-validation.mjs';

// Coordinates are integer half-micrometres. BigInt predicates and areas avoid
// cancellation; only the final SI quantities and Euclidean lengths use doubles.
export const limits = { vertices: 32, segments: 32, coordinate: 100_000 };
const coordinate = (v, path) => mm(v, path, -limits.coordinate, limits.coordinate) * 2;
const cross = (a, b, c) => BigInt(b.x - a.x) * BigInt(c.y - a.y) - BigInt(b.y - a.y) * BigInt(c.x - a.x);
const same = (a, b) => a.x === b.x && a.y === b.y;
const on = (a, b, p) => cross(a, b, p) === 0n && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
const sign = n => n < 0n ? -1 : n > 0n ? 1 : 0;
const intersects = (a, b, c, d) => on(a,b,c) || on(a,b,d) || on(c,d,a) || on(c,d,b) || (sign(cross(a,b,c)) * sign(cross(a,b,d)) < 0 && sign(cross(c,d,a)) * sign(cross(c,d,b)) < 0);
const toPoint = p => ({ x: p.x / 2000, y: p.y / 2000 });
function edge(a, b, kind = 'outer') {
  if (a.x > b.x || a.x === b.x && a.y > b.y) [a, b] = [b, a];
  return { id: `${a.x},${a.y}:${b.x},${b.y}`, kind, x1:a.x/2000, y1:a.y/2000, x2:b.x/2000, y2:b.y/2000, length:Math.hypot(b.x-a.x,b.y-a.y)/2000 };
}

export function polygon(raw, path = 'polygon', orthogonal = false) {
  object(raw, ['closed','vertices'], path);
  if (!boolean(raw.closed, `${path}.closed`)) fail(`${path}.closed`, 'Контур не замкнут. Завершите его переключателем «Замкнуть контур».');
  const points = array(raw.vertices, `${path}.vertices`, limits.vertices).map((p,i) => {
    object(p, ['x','y'], `${path}.vertices.${i}`);
    return { x:coordinate(p.x,`${path}.vertices.${i}.x`), y:coordinate(p.y,`${path}.vertices.${i}.y`) };
  });
  if (points.length < 3) fail(`${path}.vertices`, 'Задайте не менее трёх разных вершин. Первую вершину в конце не повторяйте.');
  let twiceArea = 0n;
  for (let i=0; i<points.length; i++) {
    const a=points[i], b=points[(i+1)%points.length], c=points[(i+2)%points.length];
    if (same(a,b)) fail(`${path}.vertices.${i}.x`, 'Соседние вершины совпадают; сторона имеет нулевую длину.');
    if (orthogonal && a.x !== b.x && a.y !== b.y) fail(`${path}.vertices.${i}.x`, 'Внешнее пятно ленты должно иметь только горизонтальные и вертикальные стороны.');
    if (cross(a,b,c) === 0n && (on(a,b,c) || on(b,c,a))) fail(`${path}.vertices.${i}.x`, 'Контур вырожден: соседние стороны перекрываются.');
    for (let j=i+1; j<points.length; j++) {
      if (j===i+1 || i===0 && j===points.length-1) continue;
      if (intersects(a,b,points[j],points[(j+1)%points.length])) fail(`${path}.vertices`, 'Контур пересекает или касается сам себя. Задайте один простой контур без отверстий.');
    }
    twiceArea += BigInt(a.x)*BigInt(b.y)-BigInt(a.y)*BigInt(b.x);
  }
  if (twiceArea === 0n) fail(`${path}.vertices`, 'Вырожденный контур: площадь равна нулю.');
  return { points, vertices:points.map(toPoint), areaM2:Number(twiceArea<0n?-twiceArea:twiceArea)/8e12,
    edges:points.map((a,i)=>edge(a,points[(i+1)%points.length])) };
}

// Only used for an orthogonal polygon and cell midpoints; comparisons are exact.
function inside(points, x, y) {
  let odd=false;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if(a.x===b.x && (a.y>y)!==(b.y>y) && a.x>x) odd=!odd;
  }
  return odd;
}

export function network(raw, width) {
  object(raw,['segments','footprint'],'network');
  const b=mm(width,'stripWidth',1,100_000); // half width on the doubled grid
  const segments=array(raw.segments,'network.segments',limits.segments).map((s,i)=>{
    object(s,['x1','y1','x2','y2'],`network.segments.${i}`);
    const p=Object.fromEntries(['x1','y1','x2','y2'].map(k=>[k,coordinate(s[k],`network.segments.${i}.${k}`)]));
    if(p.x1===p.x2 && p.y1===p.y2) fail(`network.segments.${i}.x2`,'Участок имеет нулевую длину.');
    if(p.x1!==p.x2 && p.y1!==p.y2) fail(`network.segments.${i}.x2`,'Участок должен быть горизонтальным или вертикальным по осям X/Y.');
    return p;
  });
  if(!segments.length) fail('network.segments','Добавьте хотя бы один участок ленты.');
  object(raw.footprint,['closed','vertices'],'network.footprint');
  boolean(raw.footprint.closed,'network.footprint.closed');
  array(raw.footprint.vertices,'network.footprint.vertices',limits.vertices);
  const footprint=raw.footprint.vertices.length || raw.footprint.closed ? polygon(raw.footprint,'network.footprint',true) : null;
  // Explicit square ends: concrete extends b/2 beyond BOTH axis endpoints.
  const rects=segments.map(s=>({x1:Math.min(s.x1,s.x2)-b,x2:Math.max(s.x1,s.x2)+b,y1:Math.min(s.y1,s.y2)-b,y2:Math.max(s.y1,s.y2)+b}));
  const sorted=values=>[...new Set(values)].sort((a,b)=>a-b);
  const xs=sorted([...rects.flatMap(r=>[r.x1,r.x2]),...(footprint?.points.map(p=>p.x)||[])]);
  const ys=sorted([...rects.flatMap(r=>[r.y1,r.y2]),...(footprint?.points.map(p=>p.y)||[])]);
  const nx=xs.length-1,ny=ys.length-1,grid=new Uint8Array(nx*ny);
  const at=(x,y)=>x>=0&&y>=0&&x<nx&&y<ny?grid[y*nx+x]:0;
  const xi=new Map(xs.map((v,i)=>[v,i])),yi=new Map(ys.map((v,i)=>[v,i]));
  for(const r of rects) for(let y=yi.get(r.y1);y<yi.get(r.y2);y++) for(let x=xi.get(r.x1);x<xi.get(r.x2);x++) grid[y*nx+x]=1;
  const neighbours=(x,y)=>[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
  function flood(seeds, value, mark) {
    const queue=[];
    const add=(x,y)=>{if(x>=0&&y>=0&&x<nx&&y<ny&&grid[y*nx+x]===value){grid[y*nx+x]=mark;queue.push([x,y]);}};
    seeds.forEach(([x,y])=>add(x,y));
    for(let i=0;i<queue.length;i++) neighbours(...queue[i]).forEach(([x,y])=>add(x,y));
  }
  const first=grid.indexOf(1);flood([[first%nx,Math.floor(first/nx)]],1,3);
  if(grid.includes(1)) fail('network.segments','Участки должны образовывать одну связанную область бетона. Разрыв или касание только углом не поддерживается.');
  const border=[];for(let x=0;x<nx;x++)border.push([x,0],[x,ny-1]);for(let y=0;y<ny;y++)border.push([0,y],[nx-1,y]);
  flood(border,0,2); // 2 exterior void; 0 enclosed void; 3 concrete
  let area=0n;
  const fragments=[];
  const boundary=(x,y,a,c)=>{if(at(x,y)!==3)fragments.push({a,c,kind:x<0||y<0||x>=nx||y>=ny||at(x,y)===2?'outer':'inner'});};
  for(let y=0;y<ny;y++) for(let x=0;x<nx;x++) if(at(x,y)===3) {
    area+=BigInt(xs[x+1]-xs[x])*BigInt(ys[y+1]-ys[y]);
    if(footprint&&!inside(footprint.points,(xs[x]+xs[x+1])/2,(ys[y]+ys[y+1])/2))fail('network.footprint.vertices','Внешний контур пятна должен включать всю область бетона, включая половину ширины за концами осей.');
    boundary(x,y-1,{x:xs[x],y:ys[y]},{x:xs[x+1],y:ys[y]});
    boundary(x,y+1,{x:xs[x],y:ys[y+1]},{x:xs[x+1],y:ys[y+1]});
    boundary(x-1,y,{x:xs[x],y:ys[y]},{x:xs[x],y:ys[y+1]});
    boundary(x+1,y,{x:xs[x+1],y:ys[y]},{x:xs[x+1],y:ys[y+1]});
  }
  // Merge adjacent collinear exposed fragments; buried intersections vanish.
  const groups=new Map();
  for(const f of fragments){const horizontal=f.a.y===f.c.y,key=`${f.kind}:${horizontal?'h':'v'}:${horizontal?f.a.y:f.a.x}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...f,horizontal});}
  const edges=[];
  for(const list of groups.values()) {
    list.sort((a,c)=>a.horizontal?a.a.x-c.a.x:a.a.y-c.a.y);
    let run=list[0];for(const next of list.slice(1)){if(same(run.c,next.a))run={...run,c:next.c};else{edges.push(edge(run.a,run.c,run.kind));run=next;}}edges.push(edge(run.a,run.c,run.kind));
  }
  edges.sort((a,c)=>a.id.localeCompare(c.id,'en'));
  return { areaM2:Number(area)/4e12, footprintAreaM2:footprint?.areaM2??null, footprint:footprint?.vertices||[], edges,
    segments:segments.map(s=>Object.fromEntries(Object.entries(s).map(([k,v])=>[k,v/2000]))),
    rects:rects.map(r=>({x:r.x1/2000,y:r.y1/2000,width:(r.x2-r.x1)/2000,height:(r.y2-r.y1)/2000})) };
}
