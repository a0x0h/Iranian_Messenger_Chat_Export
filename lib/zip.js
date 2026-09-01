(function(global){
  const table=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
  const crc32=b=>{let c=0xffffffff;for(const x of b)c=table[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0};
  const u16=n=>new Uint8Array([n&255,n>>>8&255]); const u32=n=>new Uint8Array([n&255,n>>>8&255,n>>>16&255,n>>>24&255]);
  const join=parts=>{const size=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out};
  class ZipStore{constructor(){this.files=[]} add(name,data){const bytes=typeof data==='string'?new TextEncoder().encode(data):data;this.files.push({name:name.replace(/\\/g,'/'),bytes})} blob(){const locals=[],centrals=[];let offset=0;for(const f of this.files){const name=new TextEncoder().encode(f.name),crc=crc32(f.bytes),header=join([u32(0x04034b50),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(f.bytes.length),u32(f.bytes.length),u16(name.length),u16(0),name]);locals.push(header,f.bytes);centrals.push(join([u32(0x02014b50),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(f.bytes.length),u32(f.bytes.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=header.length+f.bytes.length}const central=join(centrals),end=join([u32(0x06054b50),u16(0),u16(0),u16(this.files.length),u16(this.files.length),u32(central.length),u32(offset),u16(0)]);return new Blob([...locals,central,end],{type:'application/zip'})}}
  global.BaleZipStore=ZipStore;
})(globalThis);
