/**
 * 由 docs/house.json（genHouseCad.ts 生成，源自 houseConfig.ts）直接写出
 * 标准 R2000 DXF 三维线框数字孪生（docs/house.dxf）。
 *
 * 每个构件 = 一条 AcDb3dPolyline（底面环 + 顶面环，保留真实 Z 标高）。
 * 之后由 cadcraft 打开该 DXF 渲染校验，并另存为 docs/house.dwg。
 *
 * 之所以不走 cadcraft 的 script/3DPOLY：其命令式 3DPOLY 会丢弃 Z 坐标，
 * 只有 execute 的 3dpoly(JSON) 能保留 Z，但需逐盒调用（129 次），不可靠。
 * 直接按 DXF 规范写出最稳健，且同样完全由 houseConfig 驱动。
 *
 * 运行：npm run gen:dxf
 */
import * as fs from 'fs';
import * as path from 'path';

const docsDir = path.resolve(process.cwd(), 'docs');
const spec = JSON.parse(fs.readFileSync(path.join(docsDir, 'house.json'), 'utf8')) as {
  layers: { name: string; color: number; boxes: number[][][] }[];
};

const lines: string[] = [];
const W = (code: number, val: string | number) => { lines.push(String(code)); lines.push(String(val)); };

let h = 0x100;
const nextH = () => (h++).toString(16).toUpperCase();

// ---- HEADER ----
lines.push('0', 'SECTION', '2', 'HEADER');
W(9, '$ACADVER'); W(1, 'AC1015');
W(9, '$INSBASE'); W(10, '0.0'); W(20, '0.0'); W(30, '0.0');
lines.push('0', 'ENDSEC');

// ---- CLASSES ----
lines.push('0', 'SECTION', '2', 'CLASSES', '0', 'ENDSEC');

// ---- TABLES ----
lines.push('0', 'SECTION', '2', 'TABLES');

// LTYPE
lines.push('0', 'TABLE', '2', 'LTYPE', '70', '1');
W(0, 'LTYPE'); W(5, nextH()); W(100, 'AcDbSymbolTableRecord'); W(100, 'AcDbLinetypeTableRecord');
W(2, 'CONTINUOUS'); W(70, '0'); W(3, 'Solid line'); W(72, '65'); W(73, '0'); W(40, '0.0');
lines.push('0', 'ENDTAB');

// LAYER
lines.push('0', 'TABLE', '2', 'LAYER', '70', String(spec.layers.length));
for (const L of spec.layers) {
  W(0, 'LAYER'); W(5, nextH()); W(100, 'AcDbSymbolTableRecord'); W(100, 'AcDbLayerTableRecord');
  W(2, L.name); W(70, '0'); W(62, String(L.color)); W(6, 'CONTINUOUS'); W(370, '0');
}
lines.push('0', 'ENDTAB');
lines.push('0', 'ENDSEC');

// ---- BLOCKS（*Model_Space 作为实体宿主）----
const msH = nextH();
lines.push('0', 'SECTION', '2', 'BLOCKS');
W(0, 'BLOCK'); W(5, msH); W(100, 'AcDbEntity'); W(8, '0'); W(100, 'AcDbBlockBegin');
W(2, '*Model_Space'); W(70, '0'); W(10, '0.0'); W(20, '0.0'); W(30, '0.0'); W(3, '*Model_Space');
W(0, 'ENDBLK'); W(5, nextH()); W(100, 'AcDbEntity'); W(8, '0'); W(100, 'AcDbBlockEnd');
lines.push('0', 'ENDSEC');

// ---- ENTITIES ----
let polyCount = 0;
lines.push('0', 'SECTION', '2', 'ENTITIES');
for (const L of spec.layers) {
  for (const box of L.boxes) {
    const ph = nextH();
    W(0, 'POLYLINE'); W(5, ph); W(330, msH); W(100, 'AcDbEntity'); W(8, L.name);
    W(100, 'AcDb3dPolyline'); W(70, '8'); // 8 = 三维多段线
    for (const p of box) {
      const vh = nextH();
      W(0, 'VERTEX'); W(5, vh); W(330, ph); W(100, 'AcDbEntity'); W(8, L.name);
      W(100, 'AcDbVertex'); W(100, 'AcDb3dPolylineVertex');
      W(10, String(p[0])); W(20, String(p[1])); W(30, String(p[2]));
    }
    const sh = nextH();
    W(0, 'SEQEND'); W(5, sh); W(330, ph); W(100, 'AcDbEntity'); W(8, L.name);
    polyCount++;
  }
}
lines.push('0', 'ENDSEC');

// ---- OBJECTS ----
lines.push('0', 'SECTION', '2', 'OBJECTS', '0', 'ENDSEC');

lines.push('0', 'EOF');

fs.writeFileSync(path.join(docsDir, 'house.dxf'), lines.join('\n'));
console.log(`Wrote docs/house.dxf  (${polyCount} 3D polylines, ${lines.length} DXF lines)`);
