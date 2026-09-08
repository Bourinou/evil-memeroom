import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
// A small native tray/application mark. PNG encoding avoids a build-time graphics dependency.
function crc32(buffer) { let crc = -1; for(const byte of buffer){crc ^= byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^-1)>>>0; }
function chunk(name, data) { const type=Buffer.from(name);const size=Buffer.alloc(4);size.writeUInt32BE(data.length);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]); }
function render(size) {
const pixels=Buffer.alloc((size*4+1)*size);
const pattern=['0000000000000','0111101111000','0111111111100','0110011001100','0110011001100','0110011001100','0110011001100','0110011001100','0000000000000'];
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const scale=size/64, ux=x/scale, uy=y/scale;
  const offset=y*(size*4+1)+1+x*4, cornerX=Math.max(11-ux,0,ux-52),cornerY=Math.max(11-uy,0,uy-52);const opaque=cornerX*cornerX+cornerY*cornerY<144;
  const px=Math.floor((ux-6)/4),py=Math.floor((uy-14)/4),mark=pattern[py]?.[px]==='1';
  pixels.set(mark?[25,32,15,255]:[200,245,114,opaque?255:0],offset);
}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
await writeFile('public/icon.png',render(64));
const png=render(256),icoHeader=Buffer.alloc(22);icoHeader.writeUInt16LE(1,2);icoHeader.writeUInt16LE(1,4);icoHeader.writeUInt16LE(1,10);icoHeader.writeUInt16LE(32,12);icoHeader.writeUInt32LE(png.length,14);icoHeader.writeUInt32LE(22,18);
await writeFile('public/icon-linux.png',png);
await writeFile('public/icon.ico',Buffer.concat([icoHeader,png]));
