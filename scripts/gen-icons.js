'use strict';
const fs = require('fs');
const path = require('path');
const { SITES } = require('../src/main/sites');

const out1 = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'icons');
const out2 = path.join(__dirname, '..', 'icons'); // user requested "icons" folder at root
fs.mkdirSync(out1, { recursive: true });
fs.mkdirSync(out2, { recursive: true });

// brand color fallback palette based on hash
const palette = ['#008fff','#ffe400','#FF0000','#E4405F','#1877F2','#000','#1DB954','#9146FF','#FF5700','#0A66C2','#1AB7EA','#FF5500','#FFD700','#00A1D6','#000000','#00A0FF','#FF0000'];

function hash(s){ let h=0; for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0; return h; }

function svgFor(site){
  const initials = site.initials || site.name.slice(0,2).toUpperCase();
  const color = site.color || palette[hash(site.name)%palette.length];
  // text color white unless yellow background
  const txtColor = color.toLowerCase()==='#ffe400' ? '#0e1520' : '#fff';
  const safeInitials = initials.replace(/[<>&]/g,'').slice(0,3);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${site.name}">
  <rect width="64" height="64" rx="14" fill="${color}"/>
  <text x="50%" y="58%" font-family="Arial,system-ui" font-size="${safeInitials.length>2?20:24}" font-weight="900" fill="${txtColor}" text-anchor="middle" dominant-baseline="middle">${safeInitials}</text>
</svg>`;
  return svg;
}

const counts = {};

// Unique icon files - if icon field same, reuse same file (still create per icon slug)
const created = new Set();
for (const s of SITES){
  const slug = (s.icon || s.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).replace(/^-+|-+$/g,'') || 'site';
  const file = `${slug}.svg`;
  if (created.has(file)) continue;
  created.add(file);
  const svg = svgFor(s);
  fs.writeFileSync(path.join(out1, file), svg, 'utf8');
  fs.writeFileSync(path.join(out2, file), svg, 'utf8');
  counts[file]=1;
}

// Also create a generic favicon proxy file index.json
const index = SITES.map(s=>({ name:s.name, icon: s.icon, file: `${(s.icon||s.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}.svg`, color:s.color, initials:s.initials, url:s.url }));
fs.writeFileSync(path.join(out1,'index.json'), JSON.stringify(index,null,2),'utf8');
fs.writeFileSync(path.join(out2,'index.json'), JSON.stringify(index,null,2),'utf8');

console.log(`Created ${created.size} icon SVGs in src/renderer/assets/icons/ and icons/`);
console.log('Sites:', SITES.length);
